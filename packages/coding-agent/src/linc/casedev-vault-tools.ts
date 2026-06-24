import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import type { ExtensionContext, ToolDefinition } from "../core/extensions/types.ts";
import { getTextOutput } from "../core/tools/render-utils.ts";
import type { Theme } from "../modes/interactive/theme/theme.ts";
import {
	type CaseDevVaultObjectRecord,
	downloadCaseDevVaultObject,
	getCaseDevVault,
	listCaseDevVaultObjects,
	listCaseDevVaults,
	searchCaseDevVault,
	uploadCaseDevVaultFile,
} from "./casedev-vault-api.ts";
import { getAttachedVault } from "./vault-attachment.ts";

interface CaseDevToolDetails {
	command: string[];
}

const vaultListSchema = Type.Object({
	wide: Type.Optional(Type.Boolean({ description: "Include additional vault metadata." })),
});

const vaultGetSchema = Type.Object({
	vaultId: Type.Optional(Type.String({ description: "Case.dev vault ID. Defaults to the attached vault." })),
});

const vaultObjectListSchema = Type.Object({
	vaultId: Type.Optional(Type.String({ description: "Case.dev vault ID. Defaults to the attached vault." })),
});

const vaultSearchSchema = Type.Object({
	query: Type.String({ description: "Search query." }),
	vaultId: Type.Optional(
		Type.String({ description: "Vault ID. Defaults to the attached/focused vault when available." }),
	),
	method: Type.Optional(
		Type.Union([
			Type.Literal("hybrid"),
			Type.Literal("global"),
			Type.Literal("entity"),
			Type.Literal("fast"),
			Type.Literal("vector"),
			Type.Literal("graph"),
			Type.Literal("local"),
		]),
	),
	limit: Type.Optional(Type.Number({ description: "Maximum number of results." })),
	objectIds: Type.Optional(Type.Array(Type.String({ description: "Restrict search to specific object IDs." }))),
});

const vaultUploadSchema = Type.Object({
	filePath: Type.String({ description: "Local file path to upload." }),
	vaultId: Type.Optional(Type.String({ description: "Destination vault ID. Defaults to the attached vault." })),
	name: Type.Optional(Type.String({ description: "Optional object filename override." })),
	filename: Type.Optional(Type.String({ description: "Optional object filename override." })),
	contentType: Type.Optional(Type.String({ description: "Optional MIME type override." })),
	path: Type.Optional(Type.String({ description: "Optional vault folder path, for example /Discovery/Depositions." })),
	ingest: Type.Optional(Type.Boolean({ description: "Whether to ingest/index the upload. Defaults to true." })),
	storageOnly: Type.Optional(Type.Boolean({ description: "Store the file without ingesting or indexing it." })),
	autoIndex: Type.Optional(Type.Boolean({ description: "Set false to skip ingestion/indexing for this upload." })),
});

const vaultDownloadSchema = Type.Object({
	vaultId: Type.Optional(Type.String({ description: "Source vault ID. Defaults to the attached vault." })),
	objectId: Type.Optional(Type.String({ description: "Object ID to download." })),
	path: Type.Optional(Type.String({ description: "Vault path prefix to download." })),
	outDir: Type.Optional(Type.String({ description: "Local output directory." })),
});

type VaultListInput = Static<typeof vaultListSchema>;
type VaultGetInput = Static<typeof vaultGetSchema>;
type VaultObjectListInput = Static<typeof vaultObjectListSchema>;
type VaultSearchInput = Static<typeof vaultSearchSchema>;
type VaultUploadInput = Static<typeof vaultUploadSchema>;
type VaultDownloadInput = Static<typeof vaultDownloadSchema>;

function splitEnvList(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function envVaultId(): string | undefined {
	const value = process.env.CASE_VAULT_ID?.trim();
	return value || undefined;
}

function assertAllowedVaultId(vaultId: string): string {
	const allowedVaultIds = splitEnvList(process.env.CASE_ALLOWED_VAULT_IDS);
	if (allowedVaultIds.length > 0 && !allowedVaultIds.includes(vaultId)) {
		throw new Error(`Vault ${vaultId} is not in CASE_ALLOWED_VAULT_IDS.`);
	}
	return vaultId;
}

function getRenderArgs(args: unknown): Record<string, unknown> {
	return typeof args === "object" && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
}

function renderCall(name: string, args: unknown, theme: Theme): Text {
	const summary = Object.entries(getRenderArgs(args))
		.filter(([, value]) => value !== undefined)
		.map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(",") : String(value)}`)
		.join(" ");
	return new Text(
		theme.fg("toolTitle", theme.bold(name)) + (summary ? theme.fg("toolOutput", ` ${summary}`) : ""),
		0,
		0,
	);
}

function renderResult(result: {
	content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
}): Text {
	const output = getTextOutput(result, false).trim();
	return new Text(output ? `\n${output}` : "", 0, 0);
}

function resultContent(
	command: string[],
	output: string,
): {
	content: Array<{ type: "text"; text: string }>;
	details: CaseDevToolDetails;
} {
	return {
		content: [{ type: "text", text: output }],
		details: { command },
	};
}

function jsonResult(command: string[], data: unknown) {
	return resultContent(command, JSON.stringify(data, null, 2));
}

function resolveVaultId(ctx: ExtensionContext, vaultId: string | undefined): string {
	if (vaultId) return assertAllowedVaultId(vaultId);
	const envDefaultVaultId = envVaultId();
	if (envDefaultVaultId) return assertAllowedVaultId(envDefaultVaultId);
	const attachedVault = getAttachedVault(ctx.sessionManager);
	if (attachedVault) return assertAllowedVaultId(attachedVault.id);
	throw new Error("No vaultId provided, CASE_VAULT_ID is not set, and no Case.dev vault is attached.");
}

function shouldSkipIngest(params: VaultUploadInput): boolean {
	return params.ingest === false || params.storageOnly === true || params.autoIndex === false;
}

async function executeVaultUpload(ctx: ExtensionContext, signal: AbortSignal | undefined, params: VaultUploadInput) {
	const vaultId = resolveVaultId(ctx, params.vaultId);
	const filename = params.name ?? params.filename;
	const result = await uploadCaseDevVaultFile(
		{ ...ctx, signal },
		{
			vaultId,
			filePath: params.filePath,
			...(filename ? { name: filename } : {}),
			...(params.contentType ? { contentType: params.contentType } : {}),
			...(params.path ? { path: params.path } : {}),
			ingest: !shouldSkipIngest(params),
		},
	);
	return jsonResult(["POST", `/vault/${vaultId}/upload`], result);
}

function normalizeVaultPath(path: string): string {
	const trimmed = path.trim();
	if (!trimmed || trimmed === "/") return "/";
	const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
	return withLeadingSlash.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
}

function objectMatchesPath(object: CaseDevVaultObjectRecord, requestedPath: string): boolean {
	const normalized = normalizeVaultPath(requestedPath);
	const candidates = [object.path, object.filename, object.name]
		.filter((value): value is string => typeof value === "string" && value.length > 0)
		.map(normalizeVaultPath);
	return candidates.some((candidate) => candidate === normalized || candidate.startsWith(`${normalized}/`));
}

async function downloadVaultPath(ctx: ExtensionContext, vaultId: string, path: string, outDir: string) {
	const objects = await listCaseDevVaultObjects(ctx, vaultId);
	const matches = objects.filter((object) => objectMatchesPath(object, path));
	if (matches.length === 0) {
		throw new Error(`No vault objects matched path prefix: ${path}`);
	}
	const downloads = [];
	for (const object of matches) {
		downloads.push(
			await downloadCaseDevVaultObject(ctx, {
				vaultId,
				objectId: object.id,
				outDir,
				filename: object.filename ?? object.name ?? object.id,
			}),
		);
	}
	return {
		vaultId,
		path,
		count: downloads.length,
		downloads,
	};
}

export function createCaseDevVaultTools(): ToolDefinition[] {
	return [
		{
			name: "casedev_vault_list",
			label: "case.dev vault list",
			description: "List Case.dev vaults available to the configured Case.dev API key.",
			promptSnippet: "List Case.dev vaults available to the configured API key.",
			parameters: vaultListSchema,
			async execute(_toolCallId, params: VaultListInput, signal, _onUpdate, ctx) {
				const vaults = await listCaseDevVaults({ ...ctx, signal });
				return jsonResult(params.wide ? ["GET", "/vault", "--wide"] : ["GET", "/vault"], {
					vaults,
					total: vaults.length,
				});
			},
			renderCall: (args, theme) => renderCall("case.dev vault list", args, theme),
			renderResult,
		},
		{
			name: "casedev_vault_get",
			label: "case.dev vault get",
			description: "Get metadata for one Case.dev vault.",
			promptSnippet: "Get Case.dev vault metadata by vault ID.",
			parameters: vaultGetSchema,
			async execute(_toolCallId, params: VaultGetInput, signal, _onUpdate, ctx) {
				const vaultId = resolveVaultId(ctx, params.vaultId);
				const vault = await getCaseDevVault({ ...ctx, signal }, vaultId);
				return jsonResult(["GET", `/vault/${vaultId}`], vault);
			},
			renderCall: (args, theme) => renderCall("case.dev vault get", args, theme),
			renderResult,
		},
		{
			name: "casedev_vault_object_list",
			label: "case.dev vault objects",
			description: "List objects in a Case.dev vault.",
			promptSnippet: "List objects in a Case.dev vault.",
			parameters: vaultObjectListSchema,
			async execute(_toolCallId, params: VaultObjectListInput, signal, _onUpdate, ctx) {
				const vaultId = resolveVaultId(ctx, params.vaultId);
				const objects = await listCaseDevVaultObjects({ ...ctx, signal }, vaultId);
				return jsonResult(["GET", `/vault/${vaultId}/objects`], {
					vaultId,
					objects,
					count: objects.length,
				});
			},
			renderCall: (args, theme) => renderCall("case.dev vault objects", args, theme),
			renderResult,
		},
		{
			name: "casedev_vault_search",
			label: "case.dev vault search",
			description: "Search Case.dev vault content with hybrid, vector, graph, keyword, or entity search.",
			promptSnippet: "Search Case.dev vault content.",
			promptGuidelines: [
				"Use casedev_vault_search for document-vault search before guessing about matter documents.",
			],
			parameters: vaultSearchSchema,
			async execute(_toolCallId, params: VaultSearchInput, signal, _onUpdate, ctx) {
				const vaultId = resolveVaultId(ctx, params.vaultId);
				const result = await searchCaseDevVault({ ...ctx, signal }, vaultId, params);
				return jsonResult(["POST", `/vault/${vaultId}/search`], result);
			},
			renderCall: (args, theme) => renderCall("case.dev vault search", args, theme),
			renderResult,
		},
		{
			name: "casedev_vault_upload",
			label: "case.dev vault upload",
			description: "Upload a local file into a Case.dev vault.",
			promptSnippet: "Upload a local file into a Case.dev vault.",
			parameters: vaultUploadSchema,
			async execute(_toolCallId, params: VaultUploadInput, signal, _onUpdate, ctx) {
				return executeVaultUpload(ctx, signal, params);
			},
			renderCall: (args, theme) => renderCall("case.dev vault upload", args, theme),
			renderResult,
		},
		{
			name: "casedev_vault_download",
			label: "case.dev vault download",
			description: "Download an object or path prefix from a Case.dev vault.",
			promptSnippet: "Download a Case.dev vault object or path prefix.",
			parameters: vaultDownloadSchema,
			async execute(_toolCallId, params: VaultDownloadInput, signal, _onUpdate, ctx) {
				if (!params.objectId && !params.path) {
					throw new Error("Provide objectId or path.");
				}
				const vaultId = resolveVaultId(ctx, params.vaultId);
				const scopedCtx = { ...ctx, signal };
				if (params.objectId) {
					const objects = await listCaseDevVaultObjects(scopedCtx, vaultId);
					const object = objects.find((item) => item.id === params.objectId);
					const result = await downloadCaseDevVaultObject(scopedCtx, {
						vaultId,
						objectId: params.objectId,
						outDir: params.outDir ?? ctx.cwd,
						filename: object?.filename ?? object?.name ?? params.objectId,
					});
					return jsonResult(["GET", `/vault/${vaultId}/objects/${params.objectId}/download`], result);
				}
				const result = await downloadVaultPath(scopedCtx, vaultId, params.path!, params.outDir ?? ctx.cwd);
				return jsonResult(["GET", `/vault/${vaultId}/objects`, "download-path", params.path!], result);
			},
			renderCall: (args, theme) => renderCall("case.dev vault download", args, theme),
			renderResult,
		},
		{
			name: "vault_list",
			label: "vault_list",
			description: "List the matter document vaults available to this worker.",
			promptSnippet: "List available case.dev vaults",
			parameters: vaultListSchema,
			async execute(_toolCallId, params: VaultListInput, signal, _onUpdate, ctx) {
				const vaults = await listCaseDevVaults({ ...ctx, signal });
				return jsonResult(params.wide ? ["GET", "/vault", "--wide"] : ["GET", "/vault"], {
					vaults,
					total: vaults.length,
				});
			},
			renderCall: (args, theme) => renderCall("vault_list", args, theme),
			renderResult,
		},
		{
			name: "vault_search",
			label: "vault_search",
			description: "Search matter documents in a vault. Use this before answering matter-document questions.",
			promptSnippet: "Search matter documents in a vault",
			parameters: vaultSearchSchema,
			async execute(_toolCallId, params: VaultSearchInput, signal, _onUpdate, ctx) {
				const vaultId = resolveVaultId(ctx, params.vaultId);
				const result = await searchCaseDevVault({ ...ctx, signal }, vaultId, params);
				return jsonResult(["POST", `/vault/${vaultId}/search`], result);
			},
			renderCall: (args, theme) => renderCall("vault_search", args, theme),
			renderResult,
		},
		{
			name: "vault_upload",
			label: "vault_upload",
			description:
				"Upload a workspace file to a matter vault. Set storageOnly=true or autoIndex=false for generated deliverables that should land in the matter without ingestion.",
			promptSnippet: "Upload a workspace file to a matter vault",
			parameters: vaultUploadSchema,
			async execute(_toolCallId, params: VaultUploadInput, signal, _onUpdate, ctx) {
				return executeVaultUpload(ctx, signal, params);
			},
			renderCall: (args, theme) => renderCall("vault_upload", args, theme),
			renderResult,
		},
		{
			name: "vault_download",
			label: "vault_download",
			description: "Download a matter document into the workspace.",
			promptSnippet: "Download a matter document into the workspace",
			parameters: vaultDownloadSchema,
			async execute(_toolCallId, params: VaultDownloadInput, signal, _onUpdate, ctx) {
				if (!params.objectId && !params.path) {
					throw new Error("Provide objectId or path.");
				}
				const vaultId = resolveVaultId(ctx, params.vaultId);
				const scopedCtx = { ...ctx, signal };
				if (params.objectId) {
					const objects = await listCaseDevVaultObjects(scopedCtx, vaultId);
					const object = objects.find((item) => item.id === params.objectId);
					const result = await downloadCaseDevVaultObject(scopedCtx, {
						vaultId,
						objectId: params.objectId,
						outDir: params.outDir ?? ctx.cwd,
						filename: object?.filename ?? object?.name ?? params.objectId,
					});
					return jsonResult(["GET", `/vault/${vaultId}/objects/${params.objectId}/download`], result);
				}
				const result = await downloadVaultPath(scopedCtx, vaultId, params.path!, params.outDir ?? ctx.cwd);
				return jsonResult(["GET", `/vault/${vaultId}/objects`, "download-path", params.path!], result);
			},
			renderCall: (args, theme) => renderCall("vault_download", args, theme),
			renderResult,
		},
	];
}
