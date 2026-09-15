import { createHash } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { getBundledLincExtensionPaths } from "../src/config.ts";
import skillsMcpExtension from "../src/linc/extensions/skills-mcp.ts";

const rootUri = "skill://case.dev/org/org_test/intake/SKILL.md";
const companionUri = "skill://case.dev/org/org_test/intake/references/checklist.md";
const root = "---\nname: intake\ndescription: Structure an intake\n---\n\nRead references/checklist.md.\n";
const companion = "# Checklist\nAsk for the date.\n";

function resource(uri: string, text: string) {
	return { uri, digest: `sha256:${createHash("sha256").update(text).digest("hex")}`, size: Buffer.byteLength(text) };
}

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("Linc Case.dev MCP skills pilot extension", () => {
	test("is not bundled unless the pilot is explicitly enabled", () => {
		vi.stubEnv("LINC_MCP_SKILLS_PILOT", "0");
		expect(getBundledLincExtensionPaths().some((extension) => extension.label === "skills-mcp")).toBe(false);
		vi.stubEnv("LINC_MCP_SKILLS_PILOT", "1");
		expect(getBundledLincExtensionPaths().some((extension) => extension.label === "skills-mcp")).toBe(true);
	});

	test("loads only selected files and denies host-side actions while remote content is active", async () => {
		vi.stubEnv("LINC_MCP_SKILLS_ENDPOINT", "https://preview.api.case.dev/mcp");
		vi.stubEnv("CASEDEV_BASE_URL", "https://preview.api.case.dev");
		const methods: string[] = [];
		let rejectRequests = false;
		vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body)) as { id?: number; method: string; params: { uri?: string } };
			methods.push(body.method);
			if (rejectRequests) return new Response(null, { status: 401 });
			if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
			const result =
				body.method === "initialize"
					? {
							protocolVersion: "2025-03-26",
							capabilities: { resources: {}, extensions: { "io.modelcontextprotocol/skills": {} } },
						}
					: body.method === "skills/list"
						? {
								resultType: "complete",
								skills: [
									{
										uri: rootUri,
										frontmatter: { name: "intake", description: "Structure an intake" },
										resources: [resource(rootUri, root), resource(companionUri, companion)],
									},
								],
								nextCursor: "next-page",
							}
						: body.method === "skills/get"
							? {
									resultType: "complete",
									skill: {
										uri: rootUri,
										frontmatter: { name: "intake", description: "Structure an intake" },
										resources: [resource(rootUri, root), resource(companionUri, companion)],
									},
								}
							: { contents: [{ uri: body.params.uri, text: body.params.uri === rootUri ? root : companion }] };
			return Response.json({ jsonrpc: "2.0", id: body.id, result });
		});

		const tools = new Map<string, unknown>();
		const handlers = new Map<string, unknown>();
		const pi = {
			registerTool: (tool: { name: string }) => tools.set(tool.name, tool),
			on: (name: string, handler: unknown) => handlers.set(name, handler),
			setActiveTools: vi.fn(),
		};
		await (skillsMcpExtension as unknown as (api: typeof pi) => void)(pi);
		const ctx = {
			modelRegistry: { authStorage: { getApiKey: async () => "fixture-org-key" } },
		};
		const call = handlers.get("tool_call") as (event: { toolName: string }) => { block?: boolean } | undefined;
		expect(call({ toolName: "bash" })).toMatchObject({ block: true });
		const start = handlers.get("session_start") as () => void;
		start();
		expect(pi.setActiveTools).toHaveBeenCalledWith([
			"casedev_skill_discover",
			"casedev_skill_load",
			"casedev_skill_read",
		]);
		const beforeStart = handlers.get("before_agent_start") as (event: { systemPrompt: string }) => {
			systemPrompt: string;
		};
		expect(beforeStart({ systemPrompt: "Base" }).systemPrompt).toContain("never guess identifiers");
		const discover = tools.get("casedev_skill_discover") as {
			execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }> }>;
		};
		const discovered = await discover.execute("discover", {}, undefined, undefined, ctx);
		expect(JSON.parse(discovered.content[0].text)).toMatchObject({
			skills: [{ uri: rootUri, name: "intake", source: "org" }],
			nextCursor: "next-page",
		});
		expect(discovered.content[0].text).not.toContain("Read references/checklist.md");
		expect(discovered.content[0].text).not.toContain("sha256:");
		expect(methods).not.toContain("resources/read");
		methods.length = 0;

		const load = tools.get("casedev_skill_load") as {
			execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }> }>;
		};
		const loaded = await load.execute("call-1", { uri: rootUri }, undefined, undefined, ctx);
		expect(loaded.content[0].text).toContain('<remote_skill origin="case.dev"');
		expect(methods).toEqual(["skills/get", "resources/read"]);
		expect(call({ toolName: "bash" })).toMatchObject({ block: true });
		expect(call({ toolName: "casedev_matter_write" })).toMatchObject({ block: true });
		expect(call({ toolName: "read" })).toMatchObject({ block: true });
		expect(call({ toolName: "casedev_skill_read" })).toBeUndefined();

		const read = tools.get("casedev_skill_read") as {
			execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }> }>;
		};
		const supporting = await read.execute(
			"call-2",
			{ skillUri: rootUri, uri: companionUri },
			undefined,
			undefined,
			ctx,
		);
		expect(supporting.content[0].text).toContain(companion);
		expect(methods.at(-1)).toBe("resources/read");
		rejectRequests = true;
		methods.length = 0;
		await expect(discover.execute("failed-discover", {}, undefined, undefined, ctx)).rejects.toThrow(
			"Stop and report the failure",
		);
		expect(call({ toolName: "casedev_skill_discover" })).toMatchObject({ block: true });
		await expect(discover.execute("retry", {}, undefined, undefined, ctx)).rejects.toThrow("failed this turn");
		expect(methods).toEqual(["skills/list"]);
		beforeStart({ systemPrompt: "Base" });
		expect(call({ toolName: "casedev_skill_discover" })).toBeUndefined();
		await expect(load.execute("invalid-load", {}, undefined, undefined, ctx)).rejects.toThrow(
			"Stop and report the failure",
		);
		expect(call({ toolName: "casedev_skill_discover" })).toMatchObject({ block: true });
		beforeStart({ systemPrompt: "Base" });
		await expect(
			read.execute("unheld-read", { skillUri: rootUri, uri: companionUri }, undefined, undefined, ctx),
		).rejects.toThrow("Stop and report the failure");
		expect(call({ toolName: "casedev_skill_discover" })).toMatchObject({ block: true });
	});

	test("discards an in-flight load after another registry request fails", async () => {
		vi.stubEnv("LINC_MCP_SKILLS_ENDPOINT", "https://preview.api.case.dev/mcp");
		vi.stubEnv("CASEDEV_BASE_URL", "https://preview.api.case.dev");
		let failListing = false;
		let releaseRoot: ((response: Response) => void) | undefined;
		let rootStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			rootStarted = resolve;
		});
		vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body)) as { id: number; method: string };
			if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
			if (body.method === "skills/list" && failListing) return new Response(null, { status: 401 });
			if (body.method === "resources/read") {
				rootStarted?.();
				return new Promise<Response>((resolve) => {
					releaseRoot = resolve;
				});
			}
			const skill = {
				uri: rootUri,
				frontmatter: { name: "intake", description: "Structure an intake" },
				resources: [resource(rootUri, root), resource(companionUri, companion)],
			};
			const result =
				body.method === "initialize"
					? {
							protocolVersion: "2025-03-26",
							capabilities: { resources: {}, extensions: { "io.modelcontextprotocol/skills": {} } },
						}
					: body.method === "skills/list"
						? { resultType: "complete", skills: [skill] }
						: { resultType: "complete", skill };
			return Response.json({ jsonrpc: "2.0", id: body.id, result });
		});
		const tools = new Map<string, unknown>();
		const handlers = new Map<string, unknown>();
		const pi = {
			registerTool: (tool: { name: string }) => tools.set(tool.name, tool),
			on: (name: string, handler: unknown) => handlers.set(name, handler),
			setActiveTools: () => {},
		};
		await (skillsMcpExtension as unknown as (api: typeof pi) => void)(pi);
		const ctx = { modelRegistry: { authStorage: { getApiKey: async () => "fixture-org-key" } } };
		const discover = tools.get("casedev_skill_discover") as { execute: (...args: unknown[]) => Promise<unknown> };
		const load = tools.get("casedev_skill_load") as typeof discover;
		await discover.execute("init", {}, undefined, undefined, ctx);
		const loading = load.execute("load", { uri: rootUri }, undefined, undefined, ctx);
		await started;
		failListing = true;
		await expect(discover.execute("fail", {}, undefined, undefined, ctx)).rejects.toThrow("Stop and report");
		releaseRoot?.(Response.json({ jsonrpc: "2.0", id: 4, result: { contents: [{ uri: rootUri, text: root }] } }));
		await expect(loading).rejects.toThrow("Discarding skill result");
		const beforeStart = handlers.get("before_agent_start") as (event: { systemPrompt: string }) => void;
		beforeStart({ systemPrompt: "Base" });
		const read = tools.get("casedev_skill_read") as typeof discover;
		await expect(
			read.execute("read", { skillUri: rootUri, uri: companionUri }, undefined, undefined, ctx),
		).rejects.toThrow("Load this Case.dev skill");
	});

	test("does not send a runtime key to a different Case.dev environment", async () => {
		vi.stubEnv("LINC_MCP_SKILLS_ENDPOINT", "https://preview.api.case.dev/mcp");
		vi.stubEnv("CASEDEV_BASE_URL", "https://api.case.dev");
		const tools = new Map<string, unknown>();
		const pi = {
			registerTool: (tool: { name: string }) => tools.set(tool.name, tool),
			on: () => {},
		};
		await (skillsMcpExtension as unknown as (api: typeof pi) => void)(pi);
		const getApiKey = vi.fn(async () => "fixture-org-key");
		const load = tools.get("casedev_skill_load") as {
			execute: (...args: unknown[]) => Promise<unknown>;
		};
		await expect(
			load.execute("call-1", { uri: rootUri }, undefined, undefined, {
				modelRegistry: { authStorage: { getApiKey } },
			}),
		).rejects.toThrow("must match the runtime Case.dev API origin");
		expect(getApiKey).not.toHaveBeenCalled();
	});
});
