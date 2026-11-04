import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, expect, test, vi } from "vitest";
import { DefaultResourceLoader } from "../../../src/core/resource-loader.ts";
import skillsMcpExtension from "../../../src/linc/extensions/skills-mcp.ts";
import { createHarness } from "../harness.ts";

const uri = "skill://case.dev/org/org_test/report-pack/SKILL.md";
const scriptUri = "skill://case.dev/org/org_test/report-pack/scripts/prepare.py";
const root = "---\nname: report-pack\ndescription: Designed report preparation\n---\nRun scripts/prepare.py first.\n";
const script = "print('prepared')\n";
const skill = {
	uri,
	frontmatter: { name: "report-pack", description: "Designed report preparation" },
	resources: [
		[uri, root],
		[scriptUri, script],
	].map(([resourceUri, text]) => ({
		uri: resourceUri,
		digest: `sha256:${createHash("sha256").update(text).digest("hex")}`,
		size: Buffer.byteLength(text),
	})),
};

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

test("CD-1932 a preloaded skill is on disk and listed with the session's skills before the first turn", async () => {
	vi.stubEnv("CASEDEV_BASE_URL", "https://preview.api.case.dev");
	vi.stubEnv("LINC_MCP_SKILLS_PRELOAD", "report-pack");
	vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body)) as { id: number; method: string; params: { uri?: string } };
		if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
		const result =
			body.method === "initialize"
				? {
						protocolVersion: "2025-03-26",
						capabilities: { resources: {}, extensions: { "io.modelcontextprotocol/skills": {} } },
					}
				: body.method === "skills/list"
					? { resultType: "complete", skills: [skill] }
					: { contents: [{ uri: body.params.uri, text: body.params.uri === uri ? root : script }] };
		return Response.json({ jsonrpc: "2.0", id: body.id, result });
	});
	// The real loader applies skills that extensions add at startup; the default test loader ignores them.
	const loaderDir = mkdtempSync(join(tmpdir(), "linc-preload-loader-"));
	const resourceLoader = new DefaultResourceLoader({
		cwd: loaderDir,
		agentDir: loaderDir,
		extensionFactories: [skillsMcpExtension],
		noExtensions: true,
		noSkills: true,
	});
	await resourceLoader.reload();
	const harness = await createHarness({ resourceLoader });
	try {
		harness.authStorage.setRuntimeApiKey("casedev", "fixture-org-key");
		await harness.session.bindExtensions({});
		const skillFile = join(realpathSync(harness.tempDir), ".linc", "mcp-skills", "report-pack", "SKILL.md");
		expect(harness.session.systemPrompt).toContain("<name>report-pack</name>");
		expect(harness.session.systemPrompt).toContain(`<location>${skillFile}</location>`);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: skillFile })], { stopReason: "toolUse" }),
			fauxAssistantMessage("Prepared."),
		]);
		await harness.session.prompt("Prepare the report.");
		expect(harness.eventsOfType("tool_execution_end").map((event) => [event.toolName, event.isError])).toEqual([
			["read", false],
		]);
		const audit = harness.sessionManager
			.getEntries()
			.flatMap((entry) =>
				entry.type === "custom" && entry.customType === "linc.skills-mcp-audit"
					? [(entry.data as { action: string }).action]
					: [],
			);
		expect(audit).toEqual(["preload"]);
	} finally {
		harness.cleanup();
		rmSync(loaderDir, { recursive: true, force: true });
	}
});
