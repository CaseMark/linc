import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import type { ExtensionContext, ToolDefinition } from "../core/extensions/types.ts";
import { getTextOutput } from "../core/tools/render-utils.ts";
import type { Theme } from "../modes/interactive/theme/theme.ts";
import { formatCaseDevCliResult, runCaseDevCli } from "./casedev-cli.ts";
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
	contentType: Type.Optional(Type.String({ description: "Optional MIME type override." })),
	ingest: Type.Optional(Type.Boolean({ description: "Whether to ingest/index the upload. Defaults to true." })),
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

async function executeCaseDevTool(ctx: ExtensionContext, signal: AbortSignal | undefined, args: string[]) {
	const result = await runCaseDevCli(ctx, args, signal);
	return resultContent(args, formatCaseDevCliResult(result));
}

function resolveVaultId(ctx: ExtensionContext, vaultId: string | undefined): string {
	if (vaultId) return vaultId;
	const attachedVault = getAttachedVault(ctx.sessionManager);
	if (attachedVault) return attachedVault.id;
	throw new Error("No vaultId provided and no Case.dev vault is attached. Run /vault attach <vault-id>.");
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
				const args = ["vault", "list"];
				if (params.wide) args.push("--wide");
				return executeCaseDevTool(ctx, signal, args);
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
				return executeCaseDevTool(ctx, signal, ["vault", "get", resolveVaultId(ctx, params.vaultId)]);
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
				return executeCaseDevTool(ctx, signal, ["vault", "object", "list", resolveVaultId(ctx, params.vaultId)]);
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
				const args = ["search", "vault", params.query];
				args.push("--vault", resolveVaultId(ctx, params.vaultId));
				if (params.method) args.push("--method", params.method);
				if (params.limit !== undefined) args.push("--limit", String(params.limit));
				for (const objectId of params.objectIds ?? []) {
					args.push("--object", objectId);
				}
				return executeCaseDevTool(ctx, signal, args);
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
				const args = ["vault", "object", "upload", params.filePath, "--vault", resolveVaultId(ctx, params.vaultId)];
				if (params.name) args.push("--name", params.name);
				if (params.contentType) args.push("--content-type", params.contentType);
				if (params.ingest === false) args.push("--no-ingest");
				return executeCaseDevTool(ctx, signal, args);
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
				const args = ["vault", "download", "--vault", resolveVaultId(ctx, params.vaultId)];
				if (params.objectId) args.push("--object", params.objectId);
				if (params.path) args.push("--path", params.path);
				if (params.outDir) args.push("--out", params.outDir);
				return executeCaseDevTool(ctx, signal, args);
			},
			renderCall: (args, theme) => renderCall("case.dev vault download", args, theme),
			renderResult,
		},
	];
}
