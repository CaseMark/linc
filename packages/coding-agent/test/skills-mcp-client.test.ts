import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { CaseDevSkillsMcpClient } from "../src/linc/skills-mcp-client.ts";

const rootUri = "skill://case.dev/org/org_test/intake/SKILL.md";
const companionUri = "skill://case.dev/org/org_test/intake/references/checklist.md";
const root = "---\nname: intake\ndescription: Structure an intake\n---\n\nRead references/checklist.md.\n";
const companion = "# Checklist\nAsk for the date.\n";

function resource(uri: string, text: string) {
	return {
		uri,
		digest: `sha256:${createHash("sha256").update(text).digest("hex")}`,
		size: Buffer.byteLength(text),
	};
}

function fixture(options: { tamper?: boolean; wrongFrontmatter?: boolean; publicFallback?: boolean } = {}) {
	const calls: string[] = [];
	let listCount = 0;
	const skillUri = options.publicFallback ? "skill://case.dev/public/intake/SKILL.md" : rootUri;
	const skillCompanionUri = options.publicFallback
		? "skill://case.dev/public/intake/references/checklist.md"
		: companionUri;
	const fetcher = async (_url: string, init: RequestInit): Promise<Response> => {
		const body = JSON.parse(String(init.body)) as { id?: number; method: string; params: { uri?: string } };
		calls.push(body.method);
		if (body.method === "skills/list") listCount++;
		if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
		const entry = {
			uri: skillUri,
			frontmatter: { name: "intake", description: options.wrongFrontmatter ? "Wrong" : "Structure an intake" },
			resources: [resource(skillUri, root), resource(skillCompanionUri, companion)],
		};
		const result =
			body.method === "initialize"
				? {
						protocolVersion: "2025-03-26",
						capabilities: { resources: {}, extensions: { "io.modelcontextprotocol/skills": {} } },
					}
				: body.method === "skills/get"
					? { resultType: "complete", skill: entry }
					: body.method === "skills/list"
						? {
								resultType: "complete",
								skills: options.publicFallback ? [] : [entry],
								...(listCount === 1 ? { nextCursor: "public-next" } : {}),
							}
						: {
								contents: [
									{
										uri: body.params.uri,
										text:
											(body.params.uri === skillUri ? root : companion) + (options.tamper ? "changed" : ""),
									},
								],
							};
		return Response.json({ jsonrpc: "2.0", id: body.id, result });
	};
	return {
		client: new CaseDevSkillsMcpClient({
			endpoint: "https://preview.api.case.dev/mcp",
			apiKey: "fixture-org-key",
			fetcher,
		}),
		calls,
	};
}

describe("Case.dev MCP skills pilot client", () => {
	test("holds a complete manifest and reads only requested verified files", async () => {
		const { client, calls } = fixture();
		const entry = await client.getSkill(rootUri);
		expect(entry.resources).toHaveLength(2);
		expect(calls).toEqual(["initialize", "notifications/initialized", "skills/get"]);
		expect(await client.readResource(entry, rootUri)).toBe(root);
		expect(await client.readResource(entry, companionUri)).toBe(companion);
		expect(calls).toEqual([
			"initialize",
			"notifications/initialized",
			"skills/get",
			"resources/read",
			"resources/read",
		]);
	});

	test("resolves a selected slug from org metadata without fetching unrelated bodies", async () => {
		const { client, calls } = fixture();
		const entry = await client.resolveSkillSlug("intake");
		expect(entry.uri).toBe(rootUri);
		expect(calls).toEqual(["initialize", "notifications/initialized", "skills/list"]);
	});

	test("falls back to a direct public URI after the org listing ends", async () => {
		const { client, calls } = fixture({ publicFallback: true });
		const entry = await client.resolveSkillSlug("intake");
		expect(entry.uri).toBe("skill://case.dev/public/intake/SKILL.md");
		expect(calls).toEqual(["initialize", "notifications/initialized", "skills/list", "skills/list", "skills/get"]);
	});

	test("rejects bytes changed since the held manifest", async () => {
		const { client } = fixture({ tamper: true });
		const entry = await client.getSkill(rootUri);
		await expect(client.readResource(entry, companionUri)).rejects.toThrow("changed during this run");
	});

	test("rejects SKILL.md frontmatter that differs from the entry", async () => {
		const { client } = fixture({ wrongFrontmatter: true });
		const entry = await client.getSkill(rootUri);
		await expect(client.readResource(entry, rootUri)).rejects.toThrow("frontmatter differs");
	});

	test("does not request unmanifested resources", async () => {
		const { client, calls } = fixture();
		const entry = await client.getSkill(rootUri);
		await expect(
			client.readResource(entry, "skill://case.dev/org/org_test/intake/scripts/do-not-run.sh"),
		).rejects.toThrow("absent from the held skill manifest");
		expect(calls).not.toContain("resources/read");
	});

	test("rejects a production fallback or unsafe URI before a request", async () => {
		expect(() => new CaseDevSkillsMcpClient({ endpoint: "https://api.case.dev/mcp", apiKey: "key" })).toThrow(
			"non-production HTTPS",
		);
		expect(
			() => new CaseDevSkillsMcpClient({ endpoint: "https://api.case.dev/mcp?key=secret", apiKey: "key" }),
		).toThrow("non-production HTTPS");
		const { client, calls } = fixture();
		await expect(client.getSkill("skill://case.dev/org/org_test/intake/%2e%2e/SKILL.md")).rejects.toThrow(
			"Invalid Case.dev skill URI segment",
		);
		expect(calls).toHaveLength(0);
	});
});
