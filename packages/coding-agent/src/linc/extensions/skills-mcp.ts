import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Type } from "typebox";
import type { ExtensionContext, ExtensionFactory } from "../../core/extensions/types.ts";
import type { Skill } from "../../core/skills.ts";
import { getCaseDevApiKey } from "../casedev-cli.ts";
import { createDocumentTool } from "../document-tool.ts";
import { createPdfTool } from "../pdf-tool.ts";
import {
	CaseDevSkillsMcpClient,
	getMcpSkillManifestDigest,
	getMcpSkillResourcePath,
	type McpSkillContent,
	type McpSkillEntry,
	resolveCaseDevSkillsMcpEndpoint,
} from "../skills-mcp-client.ts";
import { createTemplateTool } from "../template-tool.ts";

const loadSchema = Type.Object(
	{
		uri: Type.Optional(Type.String({ description: "Full Case.dev skill:// URI ending in /SKILL.md." })),
		slug: Type.Optional(
			Type.String({ description: "A skill name: built-in skills first, then org skills, then the public catalog." }),
		),
	},
	{ additionalProperties: false },
);
const discoverSchema = Type.Object(
	{ cursor: Type.Optional(Type.String({ description: "Opaque nextCursor from the previous discovery page." })) },
	{ additionalProperties: false },
);

const AUDIT_ENTRY_TYPE = "linc.skills-mcp-audit";
/** Loaded Case.dev skills live here, one folder per skill, next to the session's own files. */
export const MCP_SKILLS_DIR = join(".linc", "mcp-skills");
const MANIFEST_FILE = ".linc-skill-manifest.json";
const READ_CONCURRENCY = 4;

type InstalledManifest = { uri: string; manifestDigest: string };

async function readInstalledManifest(skillDir: string): Promise<InstalledManifest | null> {
	try {
		const value = JSON.parse(await readFile(join(skillDir, MANIFEST_FILE), "utf8")) as Partial<InstalledManifest>;
		return typeof value.uri === "string" && typeof value.manifestDigest === "string"
			? { uri: value.uri, manifestDigest: value.manifestDigest }
			: null;
	} catch {
		return null;
	}
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function readAll(
	client: CaseDevSkillsMcpClient,
	entry: McpSkillEntry,
	signal: AbortSignal | undefined,
): Promise<Map<string, McpSkillContent>> {
	const contents = new Map<string, McpSkillContent>();
	const queue = [...entry.resources];
	await Promise.all(
		Array.from({ length: Math.min(READ_CONCURRENCY, queue.length) }, async () => {
			for (let resource = queue.shift(); resource; resource = queue.shift()) {
				contents.set(resource.uri, await client.readResourceContent(entry, resource.uri, signal));
			}
		}),
	);
	return contents;
}

/**
 * Write a verified bundle to `<cwd>/.linc/mcp-skills/<name>/` with its original
 * relative paths, replacing an older version atomically. An unchanged version
 * already on disk is reused without downloading it again.
 */
async function installSkill(
	client: CaseDevSkillsMcpClient,
	entry: McpSkillEntry,
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<{ skillDir: string; manifestDigest: string; reused: boolean; files: string[] }> {
	const name = String(entry.frontmatter.name);
	const manifestDigest = getMcpSkillManifestDigest(entry);
	const parent = join(await realpath(cwd), MCP_SKILLS_DIR);
	const skillDir = join(parent, name);
	const files = entry.resources.map((resource) => getMcpSkillResourcePath(entry, resource.uri)).sort();
	const installed = await readInstalledManifest(skillDir);
	if (installed?.uri === entry.uri && installed.manifestDigest === manifestDigest) {
		return { skillDir, manifestDigest, reused: true, files };
	}
	const contents = await readAll(client, entry, signal);
	await mkdir(parent, { recursive: true });
	const staging = await mkdtemp(join(parent, `.${name}-`));
	try {
		for (const [uri, content] of contents) {
			const filePath = join(staging, getMcpSkillResourcePath(entry, uri));
			await mkdir(dirname(filePath), { recursive: true });
			await writeFile(filePath, content.kind === "blob" ? content.bytes : content.text, {
				flag: "wx",
				mode: 0o644,
				signal,
			});
		}
		const manifest: InstalledManifest = { uri: entry.uri, manifestDigest };
		await writeFile(join(staging, MANIFEST_FILE), JSON.stringify(manifest), { flag: "wx" });
		signal?.throwIfAborted();
		// Move the old version aside first so the folder is never missing.
		const previous = installed || (await pathExists(skillDir)) ? `${staging}-previous` : null;
		if (previous) await rename(skillDir, previous);
		try {
			await rename(staging, skillDir);
		} catch (error) {
			if (previous) await rename(previous, skillDir);
			throw error;
		}
		if (previous) await rm(previous, { recursive: true, force: true });
	} catch (error) {
		await rm(staging, { recursive: true, force: true });
		throw error;
	}
	return { skillDir, manifestDigest, reused: false, files };
}

const skillsMcpExtension: ExtensionFactory = (pi) => {
	pi.registerTool(createDocumentTool());
	pi.registerTool(
		createPdfTool((result) => appendAudit({ action: "pdf_create", sha256: result.sha256, bytes: result.bytes })),
	);
	pi.registerTool(
		createTemplateTool((result) =>
			appendAudit({
				action: "template_fill",
				templateSlug: result.templateSlug,
				templateSha256: result.templateSha256,
				sha256: result.sha256,
				fields: result.fields,
			}),
		),
	);
	let clientState: { apiKey: string; endpoint: string; client: CaseDevSkillsMcpClient } | null = null;
	let builtInSkills: Skill[] = [];

	function appendAudit(data: Record<string, unknown>): void {
		pi.appendEntry(AUDIT_ENTRY_TYPE, { version: 2, ...data });
	}

	async function registryOperation<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
		try {
			return await operation();
		} catch (error) {
			appendAudit({ action: "registry_error", operation: operationName });
			throw new Error(
				`${error instanceof Error ? error.message : "Skill registry request failed"}. Transient errors were already retried; report the failure if you cannot continue without this skill.`,
			);
		}
	}

	async function getClient(ctx: ExtensionContext): Promise<CaseDevSkillsMcpClient> {
		const endpoint = resolveCaseDevSkillsMcpEndpoint();
		const apiKey = await getCaseDevApiKey(ctx);
		if (!clientState || clientState.apiKey !== apiKey || clientState.endpoint !== endpoint) {
			clientState = { apiKey, endpoint, client: new CaseDevSkillsMcpClient({ endpoint, apiKey }) };
		}
		return clientState.client;
	}

	function findBuiltIn(name: string): Skill | undefined {
		return builtInSkills.find((skill) => skill.name === name);
	}

	pi.registerTool({
		name: "casedev_skill_discover",
		label: "Discover skills",
		description:
			"List available skills one page at a time: built-in skills first, then the organization's own skills, then the public Case.dev catalog. Returns names and descriptions only. Pass nextCursor to get the next page.",
		promptSnippet: "List built-in, organization and catalog skills.",
		parameters: discoverSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return registryOperation("discover", async () => {
				const page = await (await getClient(ctx)).listSkills(params.cursor, signal);
				const builtIn = params.cursor
					? []
					: builtInSkills.map((skill) => ({
							name: skill.name,
							description: skill.description,
							source: "built-in",
						}));
				const remote = page.skills
					.filter((entry) => !findBuiltIn(String(entry.frontmatter.name)))
					.map((entry) => ({
						uri: entry.uri,
						name: entry.frontmatter.name,
						description: entry.frontmatter.description,
						source: entry.uri.startsWith("skill://case.dev/org/") ? "org" : "public",
					}));
				appendAudit({ action: "discover", resultCount: builtIn.length + remote.length });
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ skills: [...builtIn, ...remote], nextCursor: page.nextCursor ?? null }),
						},
					],
					details: { builtInCount: builtIn.length, remoteCount: remote.length },
				};
			});
		},
	});

	pi.registerTool({
		name: "casedev_skill_load",
		label: "Load skill",
		description:
			"Load a skill by name (slug) or by a skill:// URI from discovery. Returns its SKILL.md instructions and the folder that holds all of its files, so its scripts, references and assets can be read and run from there.",
		promptSnippet: "Load a skill by name or URI.",
		parameters: loadSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (Boolean(params.uri) === Boolean(params.slug)) throw new Error("Provide exactly one skill URI or slug");
			const builtIn = params.slug ? findBuiltIn(params.slug) : undefined;
			if (builtIn) {
				const instructions = await readFile(builtIn.filePath, "utf8");
				appendAudit({ action: "load", source: "built-in", name: builtIn.name });
				return {
					content: [
						{
							type: "text",
							text: `Skill "${builtIn.name}" (built-in). Its files are in ${builtIn.baseDir}; resolve relative paths in these instructions against that folder.\n\n${instructions}`,
						},
					],
					details: { source: "built-in", name: builtIn.name, skillDir: builtIn.baseDir },
				};
			}
			return registryOperation("load", async () => {
				const client = await getClient(ctx);
				const entry = params.uri
					? await client.getSkill(params.uri, signal)
					: await client.resolveSkillSlug(params.slug!, signal);
				const installed = await installSkill(client, entry, ctx.cwd, signal);
				const instructions = await readFile(join(installed.skillDir, "SKILL.md"), "utf8");
				const source = entry.uri.startsWith("skill://case.dev/org/") ? "org" : "public";
				appendAudit({
					action: "load",
					source,
					skillUri: entry.uri,
					manifestDigest: installed.manifestDigest,
					skillDir: installed.skillDir,
					reused: installed.reused,
				});
				return {
					content: [
						{
							type: "text",
							text: `Skill "${String(entry.frontmatter.name)}" (${source}). Its files are in ${installed.skillDir}; resolve relative paths in these instructions against that folder.\nFiles: ${installed.files.join(", ")}\n\n${instructions}`,
						},
					],
					details: {
						source,
						skillUri: entry.uri,
						manifestDigest: installed.manifestDigest,
						skillDir: installed.skillDir,
						files: installed.files,
					},
				};
			});
		},
	});

	pi.on("before_agent_start", (event) => {
		builtInSkills = (event.systemPromptOptions?.skills ?? []).filter((skill) => !skill.disableModelInvocation);
		return {
			systemPrompt: [
				event.systemPrompt,
				"Skills: besides any built-in skills listed above, the organization's own skills and the public Case.dev catalog are available. Use casedev_skill_discover to list every skill (built-in first, then the organization's, then public), and casedev_skill_load with a name or a returned URI to load one. Loading puts the skill's complete folder on disk and returns its path; read and run its files from that folder exactly as with a built-in skill. For Word files from structured text use casedev_document_create; for PDFs with paragraphs, headings and tables use casedev_document_create_pdf; to fill an existing org Word template, read its mounted MANIFEST.json and use casedev_document_fill_template. Upload a returned filePath with vault_upload.",
			].join("\n\n"),
		};
	});
};

export default skillsMcpExtension;
