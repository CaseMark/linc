import { readdir } from "node:fs/promises";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";
import skillsMcpExtension from "../../../src/linc/extensions/skills-mcp.ts";
import { createHarness } from "../harness.ts";

describe("CD-1763 portable MCP document schema", () => {
	test("advertises a lookaround-free schema and still rejects trailing line terminators before writing", async () => {
		const harness = await createHarness({ tools: [], extensionFactories: [skillsMcpExtension] });
		try {
			await harness.session.bindExtensions({});
			harness.setResponses([
				(context) => {
					const tool = context.tools?.find((tool) => tool.name === "casedev_document_create");
					expect(tool).toBeDefined();
					const schema = JSON.stringify(tool?.parameters);
					expect(schema).not.toMatch(/\(\?(?:[=!]|<[=!])/);
					expect(schema).toContain("filename");
					return fauxAssistantMessage(
						fauxToolCall("casedev_document_create", {
							filename: "unsafe.docx\n",
							blocks: [{ type: "paragraph", text: "Synthetic text" }],
						}),
						{ stopReason: "toolUse" },
					);
				},
				fauxAssistantMessage("Invalid filename rejected."),
			]);
			await harness.session.prompt("Synthetic filename validation.");
			expect(harness.eventsOfType("tool_execution_end")).toEqual([
				expect.objectContaining({ toolName: "casedev_document_create", isError: true }),
			]);
			expect(await readdir(harness.tempDir)).not.toContain("unsafe.docx\n");
		} finally {
			harness.cleanup();
		}
	});
});
