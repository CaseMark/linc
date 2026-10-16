import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import skillsMcpExtension from "../src/linc/extensions/skills-mcp.ts";
import { CaseDevSkillsMcpClient } from "../src/linc/skills-mcp-client.ts";

const rootUri = "skill://case.dev/org/org_test/intake/SKILL.md";
const assetUri = "skill://case.dev/org/org_test/intake/assets/example.pdf";
const root = "---\nname: intake\ndescription: Intake fixture\n---\nRead assets/example.pdf.";
const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 0xff, 0x80]);
const resource = (uri: string, data: Buffer) => ({
	uri,
	digest: `sha256:${createHash("sha256").update(data).digest("hex")}`,
	size: data.length,
});
const entry = {
	uri: rootUri,
	frontmatter: { name: "intake", description: "Intake fixture" },
	resources: [resource(rootUri, Buffer.from(root)), resource(assetUri, bytes)],
};
const directories: string[] = [];

function fixture(content: Record<string, unknown> = { blob: bytes.toString("base64"), mimeType: "application/pdf" }) {
	const methods: string[] = [];
	let rootContent: Record<string, unknown> = { text: root };
	const fetcher = vi.fn(async (_url: string, init: RequestInit): Promise<Response> => {
		const body = JSON.parse(String(init.body)) as { id?: number; method: string; params: { uri?: string } };
		methods.push(body.method);
		if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
		const result =
			body.method === "initialize"
				? {
						protocolVersion: "2025-03-26",
						capabilities: { resources: {}, extensions: { "io.modelcontextprotocol/skills": {} } },
					}
				: body.method === "skills/get"
					? { resultType: "complete", skill: entry }
					: { contents: [{ uri: body.params.uri, ...(body.params.uri === rootUri ? rootContent : content) }] };
		return Response.json({ jsonrpc: "2.0", id: body.id, result });
	});
	return {
		fetcher,
		methods,
		setRoot: (value: Record<string, unknown>) => {
			rootContent = value;
		},
		client: new CaseDevSkillsMcpClient({ endpoint: "https://preview.api.case.dev/mcp", apiKey: "fixture", fetcher }),
	};
}

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("verified binary MCP companions", () => {
	test("hashes decoded bytes, keeps root reads textual, and requests only held assets", async () => {
		const { client, methods } = fixture();
		const held = await client.getSkill(rootUri);
		expect(await client.readResource(held, rootUri)).toBe(root);
		expect(await client.readResourceContent(held, assetUri)).toEqual({
			kind: "blob",
			bytes,
			mimeType: "application/pdf",
		});
		await expect(client.readResourceContent(held, assetUri.replace("org_test", "other_org"))).rejects.toThrow(
			"absent",
		);
		expect(methods.filter((method) => method === "resources/read")).toHaveLength(2);
		await expect(client.readResource(held, assetUri)).rejects.toThrow("Expected a text");
	});

	test.each([
		{ blob: `${bytes.toString("base64")}\n`, mimeType: "application/pdf" },
		{ blob: "//==", mimeType: "application/pdf" },
		{ blob: "!!!!", mimeType: "application/pdf" },
		{ blob: bytes.toString("base64"), text: "ambiguous", mimeType: "application/pdf" },
		{ blob: bytes.toString("base64"), mimeType: "application/pdf\r\nX: bad" },
		{ blob: bytes.toString("base64") },
		{ blob: Buffer.from("tampered").toString("base64"), mimeType: "application/pdf" },
		{ blob: Buffer.alloc(bytes.length, 42).toString("base64"), mimeType: "application/pdf" },
		{ blob: Buffer.alloc(3 * 1024 * 1024 + 1).toString("base64"), mimeType: "application/pdf" },
	])("rejects malformed or changed blobs before returning bytes (%#)", async (content) => {
		const { client } = fixture(content);
		await expect(client.readResourceContent(await client.getSkill(rootUri), assetUri)).rejects.toThrow();
	});

	test("never accepts a binary SKILL.md, even if the bytes match the root manifest", async () => {
		const { client, setRoot } = fixture();
		setRoot({ blob: Buffer.from(root).toString("base64"), mimeType: "text/markdown" });
		await expect(client.readResourceContent(await client.getSkill(rootUri), rootUri)).rejects.toThrow("Invalid");
	});

	test.each([
		{ corrupt: false, cancel: false },
		{ corrupt: true, cancel: false },
		{ corrupt: false, cancel: true },
	])("materializes only verified data outside trusted skill directories (%j)", async ({ corrupt, cancel }) => {
		const cwd = await mkdtemp(join(tmpdir(), "linc-binary-test-"));
		directories.push(cwd);
		const wire = fixture({
			blob: (corrupt ? Buffer.from("bad") : bytes).toString("base64"),
			mimeType: "application/pdf",
		});
		const controller = new AbortController();
		if (cancel) {
			const fetcher = wire.fetcher.getMockImplementation()!;
			wire.fetcher.mockImplementation(async (url, init) => {
				const response = await fetcher(url, init);
				const body = JSON.parse(String(init.body)) as { method: string; params: { uri?: string } };
				if (body.method === "resources/read" && body.params.uri === assetUri) controller.abort();
				return response;
			});
		}
		vi.stubGlobal("fetch", wire.fetcher);
		vi.stubEnv("LINC_MCP_SKILLS_ENDPOINT", "https://preview.api.case.dev/mcp");
		vi.stubEnv("CASEDEV_BASE_URL", "https://preview.api.case.dev");
		vi.stubEnv("LINC_MCP_SKILLS_EXECUTION_APPROVED_DIGESTS", "");
		type Tool = { execute: (...args: unknown[]) => Promise<{ details: Record<string, unknown> }> };
		const tools = new Map<string, Tool>();
		const handlers = new Map<string, unknown>();
		const appendEntry = vi.fn();
		const pi = {
			registerTool: (tool: Tool & { name: string }) => tools.set(tool.name, tool),
			on: (name: string, handler: unknown) => handlers.set(name, handler),
			appendEntry,
		};
		await (skillsMcpExtension as unknown as (api: typeof pi) => void)(pi);
		const ctx = {
			cwd,
			modelRegistry: { authStorage: { getApiKey: async () => "fixture" } },
		} as unknown as ExtensionContext;
		await tools.get("casedev_skill_load")!.execute("load", { uri: rootUri }, undefined, undefined, ctx);
		expect(await readdir(cwd)).toEqual([]); // No preload.
		const call = handlers.get("tool_call") as (event: { toolName: string }) => { block?: boolean } | undefined;
		expect(call({ toolName: "bash" })).toMatchObject({ block: true });
		const read = () =>
			tools
				.get("casedev_skill_read")!
				.execute("read", { skillUri: rootUri, uri: assetUri }, controller.signal, undefined, ctx);
		if (corrupt || cancel) {
			await expect(read()).rejects.toThrow(corrupt ? "changed during this run" : "aborted");
			expect(await readdir(cwd)).toEqual([]);
			expect(call({ toolName: "read" })).toMatchObject({ block: true });
		} else {
			const result = await read();
			const filePath = result.details.filePath as string;
			expect(dirname(filePath).startsWith(`${await realpath(cwd)}/mcp-asset-`)).toBe(true);
			expect(await readFile(filePath)).toEqual(bytes);
			expect((await stat(filePath)).mode & 0o777).toBe(0o600);
			expect(result.details).toMatchObject({
				dataOnly: true,
				untrustedAsset: true,
				digest: entry.resources[1].digest,
			});
			expect(result.details).not.toHaveProperty("executionApproved");
			expect((await read()).details.filePath).not.toBe(filePath); // No overwrite/cache trust.
			expect(call({ toolName: "bash" })).toMatchObject({ block: true });
			expect(call({ toolName: "vault_upload" })).toBeUndefined();
		}
	});
});
