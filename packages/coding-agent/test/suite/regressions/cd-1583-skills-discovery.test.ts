import { createHash } from "node:crypto";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, test, vi } from "vitest";
import skillsMcpExtension from "../../../src/linc/extensions/skills-mcp.ts";
import { createHarness } from "../harness.ts";

const uri = "skill://case.dev/org/org_test/intake/SKILL.md";
const refUri = "skill://case.dev/org/org_test/intake/references/checklist.md";
const root = "---\nname: intake\ndescription: Firm intake checklist\n---\nRead references/checklist.md.\n";
const ref = "Ask for the date.";
const skill = {
	uri,
	frontmatter: { name: "intake", description: "Firm intake checklist" },
	resources: [
		[uri, root],
		[refUri, ref],
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

describe("CD-1583 safe remote skill discovery", () => {
	test("real agent loop preserves host tools and discovers, loads, and reads without preloading", async () => {
		vi.stubEnv("LINC_MCP_SKILLS_ENDPOINT", "https://preview.api.case.dev/mcp");
		vi.stubEnv("CASEDEV_BASE_URL", "https://preview.api.case.dev");
		const methods: string[] = [];
		vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body)) as { id: number; method: string; params: { uri?: string } };
			methods.push(body.method);
			if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
			const result =
				body.method === "initialize"
					? {
							protocolVersion: "2025-03-26",
							capabilities: { resources: {}, extensions: { "io.modelcontextprotocol/skills": {} } },
						}
					: body.method === "skills/list"
						? { resultType: "complete", skills: [skill] }
						: body.method === "skills/get"
							? { resultType: "complete", skill }
							: { contents: [{ uri: body.params.uri, text: body.params.uri === uri ? root : ref }] };
			return Response.json({ jsonrpc: "2.0", id: body.id, result });
		});
		const harness = await createHarness({ extensionFactories: [skillsMcpExtension] });
		try {
			harness.authStorage.setRuntimeApiKey("casedev", "fixture-org-key");
			await harness.session.bindExtensions({});
			expect(harness.session.getActiveToolNames()).toEqual(
				expect.arrayContaining([
					"bash",
					"read",
					"casedev_skill_discover",
					"casedev_skill_load",
					"casedev_skill_read",
				]),
			);
			expect(harness.session.systemPrompt).toContain("- bash:");
			expect(harness.session.systemPrompt).toContain("- read:");
			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("casedev_skill_discover", {})], { stopReason: "toolUse" }),
				fauxAssistantMessage([fauxToolCall("casedev_skill_load", { uri })], { stopReason: "toolUse" }),
				fauxAssistantMessage([fauxToolCall("casedev_skill_read", { skillUri: uri, uri: refUri })], {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage(ref),
			]);
			await harness.session.prompt("Find the firm's intake checklist and return its item.");
			expect(methods).toEqual([
				"initialize",
				"notifications/initialized",
				"skills/list",
				"skills/get",
				"resources/read",
				"resources/read",
			]);
			expect(harness.eventsOfType("tool_execution_end").map((event) => event.isError)).toEqual([
				false,
				false,
				false,
			]);
			for (const name of ["casedev_skill_discover", "casedev_skill_load", "casedev_skill_read"])
				expect(harness.session.getToolDefinition(name)?.executionMode).toBe("sequential");
			expect(
				harness.sessionManager
					.getEntries()
					.flatMap((entry) =>
						entry.type === "custom" && entry.customType === "linc.skills-mcp-audit"
							? [(entry.data as { action: string }).action]
							: [],
					),
			).toEqual(["discover", "load", "read"]);
		} finally {
			harness.cleanup();
		}
	});

	test("one registry failure stops later calls even when the model batches them", async () => {
		vi.stubEnv("LINC_MCP_SKILLS_ENDPOINT", "https://preview.api.case.dev/mcp");
		vi.stubEnv("CASEDEV_BASE_URL", "https://preview.api.case.dev");
		const fetcher = vi.fn(async () => new Response(null, { status: 401 }));
		vi.stubGlobal("fetch", fetcher);
		const harness = await createHarness({ extensionFactories: [skillsMcpExtension] });
		try {
			harness.authStorage.setRuntimeApiKey("casedev", "fixture-org-key");
			await harness.session.bindExtensions({});
			harness.setResponses([
				fauxAssistantMessage(
					[fauxToolCall("casedev_skill_discover", {}), fauxToolCall("casedev_skill_load", { uri })],
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("Skill registry authentication failed."),
			]);
			await harness.session.prompt("Find the firm's intake checklist.");
			expect(fetcher).toHaveBeenCalledTimes(1);
			expect(harness.eventsOfType("tool_execution_end").map((event) => event.isError)).toEqual([true, true]);
		} finally {
			harness.cleanup();
		}
	});
});
