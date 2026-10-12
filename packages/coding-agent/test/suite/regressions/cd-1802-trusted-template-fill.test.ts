import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, expect, test, vi } from "vitest";
import type { ExtensionContext } from "../../../src/core/extensions/types.ts";
import { createDocumentTool } from "../../../src/linc/document-tool.ts";
import { validateDocxFile } from "../../../src/linc/docx-validate.ts";
import skillsMcpExtension from "../../../src/linc/extensions/skills-mcp.ts";
import { createHarness } from "../harness.ts";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

test("CD-1802 fills a real injected template after remote load without approving shell, including rebind", async () => {
	vi.stubEnv("LINC_MCP_SKILLS_ENDPOINT", "https://preview.api.case.dev/mcp");
	vi.stubEnv("CASEDEV_BASE_URL", "https://preview.api.case.dev");
	vi.stubEnv("LINC_MCP_SKILLS_EXECUTION_APPROVED_DIGESTS", "");
	const uri = "skill://case.dev/org/org_test/intake/SKILL.md";
	const text = "---\nname: intake\ndescription: QA template intake\n---\nFill the firm's Word template.\n";
	const skill = {
		uri,
		frontmatter: { name: "intake", description: "QA template intake" },
		resources: [
			{ uri, digest: `sha256:${createHash("sha256").update(text).digest("hex")}`, size: Buffer.byteLength(text) },
		],
	};
	vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body)) as { id: number; method: string };
		if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
		const result =
			body.method === "initialize"
				? {
						protocolVersion: "2025-03-26",
						capabilities: { resources: {}, extensions: { "io.modelcontextprotocol/skills": {} } },
					}
				: body.method === "skills/get"
					? { resultType: "complete", skill }
					: { contents: [{ uri, text }] };
		return Response.json({ jsonrpc: "2.0", id: body.id, result });
	});
	const shell = vi.fn(async () => ({ content: [{ type: "text" as const, text: "unexpected" }], details: {} }));
	const bash: AgentTool = {
		name: "bash",
		label: "bash",
		description: "Never-executed sentinel",
		parameters: Type.Object({ command: Type.String() }),
		execute: shell,
	};
	const harness = await createHarness({ tools: [bash], extensionFactories: [skillsMcpExtension] });
	try {
		harness.authStorage.setRuntimeApiKey("casedev", "fixture-org-key");
		const template = await createDocumentTool().execute(
			"fixture",
			{ filename: "source.docx", blocks: [{ type: "paragraph", text: "Owner: {{owner}}" }] },
			undefined,
			undefined,
			{ cwd: harness.tempDir } as ExtensionContext,
		);
		const root = join(harness.tempDir, ".pi/skills/using-document-templates");
		await mkdir(join(root, "assets"), { recursive: true });
		await mkdir(join(root, "references"));
		await writeFile(join(root, "assets/qa.docx"), await readFile(template.details.filePath));
		await writeFile(
			join(root, "references/MANIFEST.json"),
			JSON.stringify({ templates: [{ slug: "qa-template", templatePath: "assets/qa.docx" }] }),
		);
		await harness.session.bindExtensions({});
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("casedev_skill_load", { uri }), { stopReason: "toolUse" }),
			fauxAssistantMessage(
				fauxToolCall("casedev_document_fill_template", {
					templateSlug: "qa-template",
					filename: "filled.docx",
					values: [{ name: "owner", value: "Fictional QA" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(fauxToolCall("bash", { command: "python remote.py" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Filled without remote execution."),
		]);
		await harness.session.prompt("Fill the private skill's QA template.");
		expect(harness.eventsOfType("tool_execution_end").map((event) => [event.toolName, event.isError])).toEqual([
			["casedev_skill_load", false],
			["casedev_document_fill_template", false],
			["bash", true],
		]);
		expect(validateDocxFile(join(harness.tempDir, "filled.docx"))).toEqual([]);
		await harness.session.bindExtensions({});
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("casedev_document_fill_template", {
					templateSlug: "qa-template",
					filename: "resumed.docx",
					values: [{ name: "owner", value: "Resumed QA" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(fauxToolCall("bash", { command: "echo bypass" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Approval remains unchanged."),
		]);
		await harness.session.prompt("Fill another copy after resume.");
		expect(
			harness
				.eventsOfType("tool_execution_end")
				.slice(-2)
				.map((event) => event.isError),
		).toEqual([false, true]);
		expect(shell).not.toHaveBeenCalled();
		const fills = harness.session.sessionManager
			.getBranch()
			.filter(
				(entry) =>
					entry.type === "custom" &&
					entry.customType === "linc.skills-mcp-audit" &&
					(entry.data as Record<string, unknown>)?.action === "template_fill",
			);
		expect(fills).toHaveLength(2);
		for (const entry of fills) {
			if (entry.type !== "custom") throw new Error("Expected audit entry");
			expect(entry.data).toMatchObject({ templateSlug: "qa-template", fields: ["owner"], dataOnly: true });
			expect(entry.data).not.toHaveProperty("values");
		}
	} finally {
		harness.cleanup();
	}
});
