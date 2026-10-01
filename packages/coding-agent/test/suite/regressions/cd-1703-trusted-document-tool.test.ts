import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createCaseDevVaultTools } from "../../../src/linc/casedev-vault-tools.ts";
import { validateDocxFile } from "../../../src/linc/docx-validate.ts";
import skillsMcpExtension from "../../../src/linc/extensions/skills-mcp.ts";
import { createHarness } from "../harness.ts";

const uri = "skill://case.dev/org/org_test/intake/SKILL.md";
const root = "---\nname: intake\ndescription: Intake checklist\n---\nCreate a Word intake checklist.\n";
const skill = {
	uri,
	frontmatter: { name: "intake", description: "Intake checklist" },
	resources: [
		{ uri, digest: `sha256:${createHash("sha256").update(root).digest("hex")}`, size: Buffer.byteLength(root) },
	],
};

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("CD-1703 trusted documents after unapproved remote skill loading", () => {
	test("creates and uploads real DOCX bytes through native tools without permitting shell execution", async () => {
		vi.stubEnv("LINC_MCP_SKILLS_ENDPOINT", "https://preview.api.case.dev/mcp");
		vi.stubEnv("CASEDEV_BASE_URL", "https://preview.api.case.dev");
		vi.stubEnv("CASEDEV_API_BASE_URL", "https://preview.api.case.dev");
		vi.stubEnv("CASEDEV_VERCEL_PROTECTION_BYPASS", "");
		vi.stubEnv("LINC_MCP_SKILLS_EXECUTION_APPROVED_DIGESTS", "");
		vi.stubEnv("CASE_VAULT_ID", "vault_qa");
		vi.stubEnv("CASE_ALLOWED_VAULT_IDS", "vault_qa");
		let received = Buffer.alloc(0);
		const server = createServer((request, response) => {
			const chunks: Buffer[] = [];
			request.on("data", (chunk: Buffer) => chunks.push(chunk));
			request.on("end", () => {
				received = Buffer.concat(chunks);
				response.writeHead(200, { ETag: '"qa-etag"' });
				response.end();
			});
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing test upload server address");
		const uploadUrl = `http://127.0.0.1:${address.port}/qa-upload`;
		const requests: Array<{ path: string; body: unknown }> = [];
		vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
			const path = new URL(url).pathname;
			expect(new Headers(init.headers).get("authorization")).toBe("Bearer fixture-org-key");
			const body = JSON.parse(String(init.body)) as { id: number; method: string };
			if (path !== "/mcp") {
				requests.push({ path, body });
				if (path === "/vault/vault_qa/upload") return Response.json({ uploadUrl, objectId: "object_qa" });
				if (path === "/vault/vault_qa/upload/object_qa/confirm") return Response.json({ confirmed: true });
				throw new Error(`Unexpected test API request: ${path}`);
			}
			if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
			const result =
				body.method === "initialize"
					? {
							protocolVersion: "2025-03-26",
							capabilities: { resources: {}, extensions: { "io.modelcontextprotocol/skills": {} } },
						}
					: body.method === "skills/get"
						? { resultType: "complete", skill }
						: { contents: [{ uri, text: root }] };
			return Response.json({ jsonrpc: "2.0", id: body.id, result });
		});
		const shell = vi.fn(async () => ({
			content: [{ type: "text" as const, text: "Unexpected execution" }],
			details: {},
		}));
		const bash: AgentTool = {
			name: "bash",
			label: "bash",
			description: "Test shell sentinel, never executes commands",
			parameters: Type.Object({ command: Type.String() }),
			execute: shell,
		};
		const harness = await createHarness({
			tools: [bash],
			extensionFactories: [
				skillsMcpExtension,
				(pi) => {
					for (const tool of createCaseDevVaultTools()) pi.registerTool(tool);
				},
			],
		});
		try {
			harness.authStorage.setRuntimeApiKey("casedev", "fixture-org-key");
			await harness.session.bindExtensions({});
			const filePath = join(harness.tempDir, "intake.docx");
			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("casedev_skill_load", { uri }), { stopReason: "toolUse" }),
				fauxAssistantMessage(
					fauxToolCall("casedev_document_create", {
						filename: "intake.docx",
						blocks: [
							{ type: "heading", level: 1, text: "Intake checklist" },
							{ type: "paragraph", text: "Confirm the client and date." },
						],
					}),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(fauxToolCall("bash", { command: "python remote-script.py" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage(
					fauxToolCall("vault_upload", {
						filePath,
						contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
						storageOnly: true,
					}),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(fauxToolCall("bash", { command: "echo approval-bypass" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("Document delivered without executing remote code."),
			]);
			await harness.session.prompt("Use the firm's intake skill to create and deliver a Word checklist.");
			expect(shell).not.toHaveBeenCalled();
			expect(harness.eventsOfType("tool_execution_end").map((event) => [event.toolName, event.isError])).toEqual([
				["casedev_skill_load", false],
				["casedev_document_create", false],
				["bash", true],
				["vault_upload", false],
				["bash", true],
			]);
			expect(received).toEqual(await readFile(filePath));
			expect(validateDocxFile(filePath)).toEqual([]);
			expect(requests).toEqual([
				{
					path: "/vault/vault_qa/upload",
					body: {
						filename: "intake.docx",
						contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
						sizeBytes: received.length,
						auto_index: false,
					},
				},
				{
					path: "/vault/vault_qa/upload/object_qa/confirm",
					body: { success: true, sizeBytes: received.length, etag: '"qa-etag"' },
				},
			]);
			// Rebinding restores the gate from the real session ledger. Creating a
			// document in the resumed session still cannot approve remote code.
			await harness.session.bindExtensions({});
			harness.setResponses([
				fauxAssistantMessage(
					fauxToolCall("casedev_document_create", {
						filename: "resumed.docx",
						blocks: [{ type: "paragraph", text: "Resumed session" }],
					}),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(fauxToolCall("bash", { command: "echo still-blocked" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("Remote code remains unapproved."),
			]);
			await harness.session.prompt("Create a second document without executing any remote script.");
			expect(shell).not.toHaveBeenCalled();
			expect(
				harness
					.eventsOfType("tool_execution_end")
					.slice(-2)
					.map((event) => event.isError),
			).toEqual([false, true]);
			expect(await readdir(harness.tempDir)).toEqual(expect.arrayContaining(["intake.docx", "resumed.docx"]));
		} finally {
			harness.cleanup();
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		}
	});
});
