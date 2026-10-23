import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { getBundledLincExtensionPaths, isCaseDevSkillsEnabled } from "../src/config.ts";
import skillsMcpExtension from "../src/linc/extensions/skills-mcp.ts";

const rootUri = "skill://case.dev/org/org_test/intake/SKILL.md";
const referenceUri = "skill://case.dev/org/org_test/intake/references/checklist.md";
const scriptUri = "skill://case.dev/org/org_test/intake/scripts/prepare.py";
const assetUri = "skill://case.dev/org/org_test/intake/assets/Intake%20Form.pdf";
const root =
	"---\nname: intake\ndescription: Structure an intake\n---\n\nRun scripts/prepare.py, then read references/checklist.md.\n";
const reference = "# Checklist\nAsk for the date.\n";
const script = "print('prepared')\n";
const asset = Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 0xff, 0x80]);

type ToolResult = { content: Array<{ text: string }>; details: Record<string, unknown> };
type Tool = { execute: (...args: unknown[]) => Promise<ToolResult> };

function resource(uri: string, data: string | Buffer) {
	const bytes = typeof data === "string" ? Buffer.from(data) : data;
	return { uri, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, size: bytes.length };
}

const directories: string[] = [];

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function catalog() {
	const files = new Map<string, string | Buffer>([
		[rootUri, root],
		[referenceUri, reference],
		[scriptUri, script],
		[assetUri, asset],
	]);
	const methods: string[] = [];
	const state = { failStatus: 0, corruptAsset: false, publicDocx: true };
	const entry = () => ({
		uri: rootUri,
		frontmatter: { name: "intake", description: "Structure an intake" },
		resources: [...files].map(([uri, data]) => resource(uri, data)),
	});
	const publicDocx = {
		uri: "skill://case.dev/public/docx/SKILL.md",
		frontmatter: { name: "docx", description: "Catalog copy of a built-in skill" },
		resources: [resource("skill://case.dev/public/docx/SKILL.md", "---\nname: docx\ndescription: x\n---\n")],
	};
	vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body)) as { id?: number; method: string; params: { uri?: string } };
		methods.push(body.method);
		if (state.failStatus) return new Response(null, { status: state.failStatus });
		if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
		let result: unknown;
		if (body.method === "initialize") {
			result = {
				protocolVersion: "2025-03-26",
				capabilities: { resources: {}, extensions: { "io.modelcontextprotocol/skills": {} } },
			};
		} else if (body.method === "skills/list") {
			result = { resultType: "complete", skills: state.publicDocx ? [entry(), publicDocx] : [entry()] };
		} else if (body.method === "skills/get") {
			result = { resultType: "complete", skill: entry() };
		} else {
			const data = files.get(body.params.uri!)!;
			result = {
				contents: [
					typeof data === "string"
						? { uri: body.params.uri, text: data }
						: {
								uri: body.params.uri,
								blob: (state.corruptAsset ? Buffer.from("bad") : data).toString("base64"),
								mimeType: "application/pdf",
							},
				],
			};
		}
		return Response.json({ jsonrpc: "2.0", id: body.id, result });
	});
	return { files, methods, state };
}

async function setup(
	builtInSkills: Array<{ name: string; description: string; filePath: string; baseDir: string }> = [],
) {
	vi.stubEnv("CASEDEV_BASE_URL", "https://preview.api.case.dev");
	const cwd = await mkdtemp(join(tmpdir(), "linc-skills-mcp-"));
	directories.push(cwd);
	const tools = new Map<string, Tool>();
	const handlers = new Map<string, unknown>();
	const audit: Array<Record<string, unknown>> = [];
	const pi = {
		registerTool: (tool: Tool & { name: string }) => tools.set(tool.name, tool),
		on: (name: string, handler: unknown) => handlers.set(name, handler),
		appendEntry: (_type: string, data: Record<string, unknown>) => audit.push(data),
	};
	await (skillsMcpExtension as unknown as (api: typeof pi) => void)(pi);
	const beforeStart = handlers.get("before_agent_start") as (event: unknown) => { systemPrompt: string };
	const prompt = beforeStart({
		systemPrompt: "Base",
		systemPromptOptions: {
			skills: builtInSkills.map((skill) => ({ ...skill, disableModelInvocation: false, sourceInfo: {} })),
		},
	}).systemPrompt;
	const ctx = { cwd, modelRegistry: { authStorage: { getApiKey: async () => "fixture-org-key" } } };
	const run = (name: string, params: Record<string, unknown>, signal?: AbortSignal) =>
		tools.get(name)!.execute(name, params, signal, undefined, ctx);
	return { cwd, tools, handlers, audit, prompt, run };
}

describe("Case.dev skills over MCP", () => {
	test("is bundled only when the host turns it on", () => {
		expect(isCaseDevSkillsEnabled({})).toBe(false);
		expect(isCaseDevSkillsEnabled({ CASEDEV_BASE_URL: "https://api.case.dev" })).toBe(false);
		expect(isCaseDevSkillsEnabled({ LINC_MCP_SKILLS: "1" })).toBe(true);
		expect(isCaseDevSkillsEnabled({ LINC_MCP_SKILLS_PILOT: "1" })).toBe(true);
		vi.stubEnv("LINC_MCP_SKILLS", "1");
		expect(getBundledLincExtensionPaths().some((extension) => extension.label === "skills-mcp")).toBe(true);
	});

	test("installs the complete skill folder and never blocks other tools", async () => {
		const wire = catalog();
		const { cwd, handlers, run, prompt } = await setup();
		expect(handlers.has("tool_call")).toBe(false);
		expect(prompt).toContain("casedev_skill_load");
		expect(prompt).not.toMatch(/untrusted|approval/i);

		const loaded = await run("casedev_skill_load", { slug: "intake" });
		const skillDir = join(await realpath(cwd), ".linc", "mcp-skills", "intake");
		expect(loaded.details).toMatchObject({ source: "org", skillUri: rootUri, skillDir });
		expect(loaded.content[0].text).toContain(`Its files are in ${skillDir}`);
		expect(loaded.content[0].text).toContain("Run scripts/prepare.py");
		expect(await readFile(join(skillDir, "SKILL.md"), "utf8")).toBe(root);
		expect(await readFile(join(skillDir, "references", "checklist.md"), "utf8")).toBe(reference);
		expect(await readFile(join(skillDir, "scripts", "prepare.py"), "utf8")).toBe(script);
		expect(await readFile(join(skillDir, "assets", "Intake Form.pdf"))).toEqual(asset);
		expect((await stat(join(skillDir, "scripts", "prepare.py"))).mode & 0o777).toBe(0o600);
		expect((await stat(join(skillDir, "scripts"))).mode & 0o777).toBe(0o700);
		expect(wire.methods.filter((method) => method === "resources/read")).toHaveLength(4);
	});

	test("reuses an unchanged folder and atomically replaces a changed one", async () => {
		const wire = catalog();
		const { cwd, run } = await setup();
		await run("casedev_skill_load", { uri: rootUri });
		wire.methods.length = 0;
		const again = await run("casedev_skill_load", { uri: rootUri });
		expect(wire.methods).not.toContain("resources/read");
		const skillDir = again.details.skillDir as string;

		wire.files.delete(referenceUri);
		wire.files.set(scriptUri, "print('v2')\n");
		await run("casedev_skill_load", { uri: rootUri });
		expect(await readFile(join(skillDir, "scripts", "prepare.py"), "utf8")).toBe("print('v2')\n");
		await expect(readFile(join(skillDir, "references", "checklist.md"))).rejects.toThrow();
		expect(await readdir(join(await realpath(cwd), ".linc", "mcp-skills"))).toEqual(["intake"]);
	});

	test("keeps the previous version and leaves nothing partial when a file fails verification", async () => {
		const wire = catalog();
		const { cwd, run } = await setup();
		await run("casedev_skill_load", { uri: rootUri });
		wire.files.set(scriptUri, "print('v2')\n");
		wire.state.corruptAsset = true;
		await expect(run("casedev_skill_load", { uri: rootUri })).rejects.toThrow("changed while loading");
		const parent = join(await realpath(cwd), ".linc", "mcp-skills");
		expect(await readdir(parent)).toEqual(["intake"]);
		expect(await readFile(join(parent, "intake", "scripts", "prepare.py"), "utf8")).toBe(script);
	});

	test("lists built-in skills first, hides catalog duplicates and loads built-ins locally", async () => {
		const wire = catalog();
		const builtInDir = await mkdtemp(join(tmpdir(), "linc-builtin-"));
		directories.push(builtInDir);
		await mkdir(join(builtInDir, "docx"));
		await writeFile(
			join(builtInDir, "docx", "SKILL.md"),
			"---\nname: docx\ndescription: Word files\n---\nUse python-docx.\n",
		);
		const { run } = await setup([
			{
				name: "docx",
				description: "Word files",
				filePath: join(builtInDir, "docx", "SKILL.md"),
				baseDir: join(builtInDir, "docx"),
			},
		]);
		const listed = JSON.parse((await run("casedev_skill_discover", {})).content[0].text) as {
			skills: Array<{ name: string; source: string }>;
		};
		expect(listed.skills.map((skill) => [skill.name, skill.source])).toEqual([
			["docx", "built-in"],
			["intake", "org"],
		]);
		wire.methods.length = 0;
		const loaded = await run("casedev_skill_load", { slug: "docx" });
		expect(loaded.details).toMatchObject({ source: "built-in", skillDir: join(builtInDir, "docx") });
		expect(loaded.content[0].text).toContain("Use python-docx.");
		const byUri = await run("casedev_skill_load", { uri: "skill://case.dev/public/docx/SKILL.md" });
		expect(byUri.details).toMatchObject({ source: "built-in", skillDir: join(builtInDir, "docx") });
		expect(wire.methods).toEqual([]);
	});

	test("a registry failure fails only that call", async () => {
		const wire = catalog();
		const { run, audit } = await setup();
		wire.state.failStatus = 401;
		await expect(run("casedev_skill_discover", {})).rejects.toThrow("HTTP 401");
		expect(audit.at(-1)).toMatchObject({ action: "registry_error", operation: "discover" });
		wire.state.failStatus = 0;
		const listed = await run("casedev_skill_discover", {});
		expect(listed.content[0].text).toContain("intake");
		await expect(run("casedev_skill_load", { slug: "intake" })).resolves.toBeDefined();
	});

	test("does not send the runtime key to a different Case.dev environment", async () => {
		catalog();
		vi.stubEnv("LINC_MCP_SKILLS_ENDPOINT", "https://api.case.dev/mcp");
		const { run } = await setup();
		await expect(run("casedev_skill_load", { uri: rootUri })).rejects.toThrow(
			"must match the runtime Case.dev API origin",
		);
	});
});
