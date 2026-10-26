import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
	CaseDevSkillsMcpClient,
	getMcpSkillManifestDigest,
	getMcpSkillResourcePath,
	resolveCaseDevSkillsMcpEndpoint,
} from "../src/linc/skills-mcp-client.ts";

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

describe("Case.dev MCP skills client", () => {
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

	test("discovers one bounded metadata page and rejects unsafe cursors before a request", async () => {
		const { client, calls } = fixture();
		const page = await client.listSkills();
		expect(page.skills[0].uri).toBe(rootUri);
		expect(page.nextCursor).toBe("public-next");
		expect(calls).toEqual(["initialize", "notifications/initialized", "skills/list"]);
		await expect(client.listSkills("x".repeat(1025))).rejects.toThrow("Invalid Case.dev skill cursor");
		expect(calls).not.toContain("resources/read");
	});

	test("falls back to a direct public URI after the org listing ends", async () => {
		const { client, calls } = fixture({ publicFallback: true });
		const entry = await client.resolveSkillSlug("intake");
		expect(entry.uri).toBe("skill://case.dev/public/intake/SKILL.md");
		expect(calls).toEqual(["initialize", "notifications/initialized", "skills/list", "skills/list", "skills/get"]);
	});

	test("uses direct lookup after org-first listing reaches the public catalog", async () => {
		const calls: string[] = [];
		let page = 0;
		const publicUri = "skill://case.dev/public/intake/SKILL.md";
		const listedEntries = [
			{
				uri: "skill://case.dev/org/org_test/other/SKILL.md",
				frontmatter: { name: "other", description: "Other firm skill" },
				resources: [resource("skill://case.dev/org/org_test/other/SKILL.md", root.replace("intake", "other"))],
			},
			{
				uri: "skill://case.dev/public/another/SKILL.md",
				frontmatter: { name: "another", description: "Another public skill" },
				resources: [resource("skill://case.dev/public/another/SKILL.md", root.replace("intake", "another"))],
			},
		];
		const targetEntry = {
			uri: publicUri,
			frontmatter: { name: "intake", description: "Public intake" },
			resources: [resource(publicUri, root)],
		};
		const client = new CaseDevSkillsMcpClient({
			endpoint: "https://preview.api.case.dev/mcp",
			apiKey: "fixture-org-key",
			fetcher: async (_url, init) => {
				const body = JSON.parse(String(init.body)) as { id?: number; method: string };
				calls.push(body.method);
				if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
				const result =
					body.method === "initialize"
						? {
								protocolVersion: "2025-03-26",
								capabilities: { resources: {}, extensions: { "io.modelcontextprotocol/skills": {} } },
							}
						: body.method === "skills/get"
							? { resultType: "complete", skill: targetEntry }
							: {
									resultType: "complete",
									skills: [listedEntries[page++]],
									nextCursor: `next-${page}`,
								};
				return Response.json({ jsonrpc: "2.0", id: body.id, result });
			},
		});

		expect((await client.resolveSkillSlug("intake")).uri).toBe(publicUri);
		expect(calls).toEqual(["initialize", "notifications/initialized", "skills/list", "skills/list", "skills/get"]);
	});

	test("rejects bytes changed since the held manifest", async () => {
		const { client } = fixture({ tamper: true });
		const entry = await client.getSkill(rootUri);
		await expect(client.readResource(entry, companionUri)).rejects.toThrow("changed while loading");
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

	test("accepts production and loopback endpoints and rejects unsafe ones before a request", async () => {
		expect(() => new CaseDevSkillsMcpClient({ endpoint: "https://api.case.dev/mcp", apiKey: "key" })).not.toThrow();
		expect(() => new CaseDevSkillsMcpClient({ endpoint: "http://localhost:2728/mcp", apiKey: "key" })).not.toThrow();
		expect(() => new CaseDevSkillsMcpClient({ endpoint: "http://api.case.dev/mcp", apiKey: "key" })).toThrow(
			"HTTPS Case.dev MCP endpoint",
		);
		expect(
			() => new CaseDevSkillsMcpClient({ endpoint: "https://api.case.dev/mcp?key=secret", apiKey: "key" }),
		).toThrow("HTTPS Case.dev MCP endpoint");
		expect(() => new CaseDevSkillsMcpClient({ endpoint: "not-a-url", apiKey: "key" })).toThrow(
			"HTTPS Case.dev MCP endpoint",
		);
		const { client, calls } = fixture();
		await expect(client.getSkill("skill://case.dev/org/org_test/intake/%2e%2e/SKILL.md")).rejects.toThrow(
			"Invalid Case.dev skill URI segment",
		);
		expect(calls).toHaveLength(0);
	});

	test("resolves the endpoint from the runtime origin and refuses another environment", () => {
		expect(resolveCaseDevSkillsMcpEndpoint({ CASEDEV_BASE_URL: "https://api.case.dev" })).toBe(
			"https://api.case.dev/mcp",
		);
		expect(
			resolveCaseDevSkillsMcpEndpoint({
				CASE_API_URL: "https://preview.api.case.dev/",
				LINC_MCP_SKILLS_ENDPOINT: "https://preview.api.case.dev/mcp",
			}),
		).toBe("https://preview.api.case.dev/mcp");
		expect(() =>
			resolveCaseDevSkillsMcpEndpoint({
				CASEDEV_BASE_URL: "https://api.case.dev",
				LINC_MCP_SKILLS_ENDPOINT: "https://preview.api.case.dev/mcp",
			}),
		).toThrow("must match the runtime Case.dev API origin");
		expect(() => resolveCaseDevSkillsMcpEndpoint({})).toThrow("require CASEDEV_BASE_URL");
	});

	test("maps manifest resources to their relative paths inside the skill", async () => {
		const { client } = fixture();
		const entry = await client.getSkill(rootUri);
		expect(getMcpSkillResourcePath(entry, rootUri)).toBe("SKILL.md");
		expect(getMcpSkillResourcePath(entry, companionUri)).toBe("references/checklist.md");
		expect(getMcpSkillResourcePath(entry, "skill://case.dev/org/org_test/intake/assets/My%20Template.docx")).toBe(
			"assets/My Template.docx",
		);
		expect(() => getMcpSkillResourcePath(entry, "skill://case.dev/org/org_test/other/SKILL.md")).toThrow(
			"outside the skill root",
		);
	});

	test("retries transient failures and stops on permanent ones", async () => {
		const statuses = [503, 429, 200];
		const seen: number[] = [];
		const client = new CaseDevSkillsMcpClient({
			endpoint: "https://preview.api.case.dev/mcp",
			apiKey: "fixture-org-key",
			retryDelaysMs: [0, 0],
			fetcher: async (_url, init) => {
				const status = statuses.shift() ?? 200;
				seen.push(status);
				const body = JSON.parse(String(init.body)) as { id?: number; method: string };
				if (status !== 200) return new Response(null, { status });
				if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
				return Response.json({
					jsonrpc: "2.0",
					id: body.id,
					result: {
						protocolVersion: "2025-03-26",
						capabilities: { resources: {}, extensions: { "io.modelcontextprotocol/skills": {} } },
					},
				});
			},
		});
		await client.initialize();
		expect(seen).toEqual([503, 429, 200, 200]);

		let unauthorized = 0;
		const denied = new CaseDevSkillsMcpClient({
			endpoint: "https://preview.api.case.dev/mcp",
			apiKey: "fixture-org-key",
			retryDelaysMs: [0, 0],
			fetcher: async () => {
				unauthorized++;
				return new Response(null, { status: 401 });
			},
		});
		await expect(denied.initialize()).rejects.toThrow("HTTP 401");
		expect(unauthorized).toBe(1);

		let unavailable = 0;
		const down = new CaseDevSkillsMcpClient({
			endpoint: "https://preview.api.case.dev/mcp",
			apiKey: "fixture-org-key",
			retryDelaysMs: [0, 0],
			fetcher: async () => {
				unavailable++;
				return new Response(null, { status: 503 });
			},
		});
		await expect(down.initialize()).rejects.toThrow("HTTP 503");
		expect(unavailable).toBe(3);
	});

	test("surfaces bounded sanitized JSON-RPC diagnostics", async () => {
		const client = new CaseDevSkillsMcpClient({
			endpoint: "https://preview.api.case.dev/mcp",
			apiKey: "fixture-org-key",
			fetcher: async (_url, init) => {
				const body = JSON.parse(String(init.body)) as { id: number };
				return Response.json({
					jsonrpc: "2.0",
					id: body.id,
					error: { code: -32600, message: `Denied\n${"x".repeat(500)}`, data: { secret: "do-not-return" } },
				});
			},
		});

		await expect(client.initialize()).rejects.toThrow(/initialize error -32600: Denied x+/);
		await expect(client.initialize()).rejects.not.toThrow("do-not-return");
	});

	test("derives a stable content-bound manifest digest", async () => {
		const { client } = fixture();
		const entry = await client.getSkill(rootUri);
		const reversed = { ...entry, resources: [...entry.resources].reverse() };
		expect(getMcpSkillManifestDigest(reversed)).toBe(getMcpSkillManifestDigest(entry));
		expect(getMcpSkillManifestDigest({ ...entry, resources: entry.resources.slice(0, 1) })).not.toBe(
			getMcpSkillManifestDigest(entry),
		);
	});
});
