import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, expect, test, vi } from "vitest";
import { createCaseDevVaultTools } from "../../../src/linc/casedev-vault-tools.ts";
import skillsMcpExtension from "../../../src/linc/extensions/skills-mcp.ts";
import { createHarness } from "../harness.ts";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

test("CD-1830 creates and uploads PDF bytes after loading a Case.dev skill, with the shell usable throughout", async () => {
	vi.stubEnv("LINC_MCP_SKILLS_ENDPOINT", "https://preview.api.case.dev/mcp");
	vi.stubEnv("CASEDEV_BASE_URL", "https://preview.api.case.dev");
	vi.stubEnv("CASEDEV_API_BASE_URL", "https://preview.api.case.dev");
	vi.stubEnv("CASEDEV_VERCEL_PROTECTION_BYPASS", "");
	vi.stubEnv("CASE_VAULT_ID", "vault_qa");
	vi.stubEnv("CASE_ALLOWED_VAULT_IDS", "vault_qa");
	const uri = "skill://case.dev/org/org_test/summary/SKILL.md";
	const root = "---\nname: summary\ndescription: Synthetic summary\n---\nCreate a PDF.\n";
	const skill = {
		uri,
		frontmatter: { name: "summary", description: "Synthetic summary" },
		resources: [
			{ uri, digest: `sha256:${createHash("sha256").update(root).digest("hex")}`, size: Buffer.byteLength(root) },
		],
	};
	const pdf = Buffer.from("%PDF-1.3\nSynthetic fixture\n%%EOF\n");
	let uploaded = Buffer.alloc(0);
	const server = createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => {
			uploaded = Buffer.concat(chunks);
			response.writeHead(200, { ETag: '"pdf-etag"' });
			response.end();
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing QA upload address");
	vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit) => {
		expect(new Headers(init.headers).get("authorization")).toBe("Bearer fixture-org-key");
		const path = new URL(url).pathname;
		if (path === "/format/v1/document") return new Response(pdf, { headers: { "Content-Type": "application/pdf" } });
		if (path === "/vault/vault_qa/upload")
			return Response.json({ uploadUrl: `http://127.0.0.1:${address.port}/upload`, objectId: "object_qa" });
		if (path === "/vault/vault_qa/upload/object_qa/confirm") return Response.json({ confirmed: true });
		expect(path).toBe("/mcp");
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
					: { contents: [{ uri, text: root }] };
		return Response.json({ jsonrpc: "2.0", id: body.id, result });
	});
	const shell = vi.fn(async () => ({
		content: [{ type: "text" as const, text: "ran" }],
		details: {},
	}));
	const bash: AgentTool = {
		name: "bash",
		label: "bash",
		description: "Shell sentinel",
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
		const filePath = join(harness.tempDir, "summary.pdf");
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("casedev_skill_load", { uri }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("bash", { command: "python3 prepare.py" }), { stopReason: "toolUse" }),
			fauxAssistantMessage(
				fauxToolCall("casedev_document_create_pdf", {
					filename: "summary.pdf",
					blocks: [{ type: "paragraph", text: "Synthetic summary" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall("vault_upload", { filePath, contentType: "application/pdf", storageOnly: true }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(fauxToolCall("bash", { command: "echo done" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("PDF delivered."),
		]);
		await harness.session.prompt("Use the synthetic skill to deliver a PDF.");
		expect(harness.eventsOfType("tool_execution_end").map((event) => [event.toolName, event.isError])).toEqual([
			["casedev_skill_load", false],
			["bash", false],
			["casedev_document_create_pdf", false],
			["vault_upload", false],
			["bash", false],
		]);
		expect(uploaded).toEqual(pdf);
		expect(await readFile(filePath)).toEqual(pdf);
		expect(shell).toHaveBeenCalledTimes(2);
		const audit = harness.sessionManager
			.getBranch()
			.filter((entry) => entry.type === "custom" && entry.customType === "linc.skills-mcp-audit");
		expect(audit).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					data: expect.objectContaining({
						action: "pdf_create",
						sha256: createHash("sha256").update(pdf).digest("hex"),
					}),
				}),
			]),
		);
		await harness.session.bindExtensions({});
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("casedev_document_create_pdf", {
					filename: "resumed.pdf",
					blocks: [{ type: "paragraph", text: "Resumed" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(fauxToolCall("bash", { command: "after-resume" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("Resumed."),
		]);
		await harness.session.prompt("Create a resumed PDF.");
		expect(
			harness
				.eventsOfType("tool_execution_end")
				.slice(-2)
				.map((event) => [event.toolName, event.isError]),
		).toEqual([
			["casedev_document_create_pdf", false],
			["bash", false],
		]);
		expect(shell).toHaveBeenCalledTimes(3);
	} finally {
		harness.cleanup();
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	}
});
