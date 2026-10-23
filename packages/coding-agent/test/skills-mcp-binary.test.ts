import { createHash } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
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

describe("verified binary MCP companions", () => {
	test.each([`application/pdf;${"x".repeat(241)}`, `application/pdf;${"é".repeat(121)}`])(
		"rejects MIME metadata over 256 UTF-8 bytes before returning or persisting it (%#)",
		async (mimeType) => {
			const { client } = fixture({ blob: bytes.toString("base64"), mimeType });
			await expect(client.readResourceContent(await client.getSkill(rootUri), assetUri)).rejects.toThrow(
				"Invalid Case.dev text or binary resource",
			);
		},
	);

	test("accepts MIME metadata at the exact 256-byte boundary", async () => {
		const mimeType = `application/pdf;${"x".repeat(240)}`;
		expect(Buffer.byteLength(mimeType)).toBe(256);
		const { client } = fixture({ blob: bytes.toString("base64"), mimeType });
		expect(await client.readResourceContent(await client.getSkill(rootUri), assetUri)).toMatchObject({
			kind: "blob",
			mimeType,
			bytes,
		});
	});
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
});
