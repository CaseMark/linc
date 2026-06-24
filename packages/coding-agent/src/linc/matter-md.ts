import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import type { ExtensionContext, ToolResultEvent, ToolResultEventResult } from "../core/extensions/types.ts";
import type { ReadonlySessionManager } from "../core/session-manager.ts";
import {
	type CaseDevVaultObjectRecord,
	downloadCaseDevVaultObject,
	listCaseDevVaultObjects,
	uploadCaseDevVaultFile,
} from "./casedev-vault-api.ts";
import { getAttachedVault, type LincVaultRef } from "./vault-attachment.ts";

export const MATTER_MD_FILENAME = "MATTER.md";
export const LINC_MATTER_MD_ENTRY_TYPE = "linc.matterMd";

const MATTER_MD_STATUS_KEY = "linc.matter";

const USING_MATTER_MD_GUIDANCE = `# Using MATTER.md

MATTER.md is the durable whiteboard for a legal matter. Treat it as durable project state, not source evidence.

At the start of matter work, read MATTER.md and use it to orient around representation, goals, jurisdiction, source rules, open questions, and current board.

Write only durable matter-level context that helps a future agent or session orient faster: what the matter is, who the user represents, adverse or important non-client parties, matter goals, jurisdiction/forum/governing law, source rules, durable user preferences, stable decisions, open questions, durable tasks, and short source-map entries that point to vault objects or documents.

Do not put full document text, bulk OCR, transcript content, long legal research dumps, raw evidence, chat history, scratchpad reasoning, credentials, sync tokens, or transient notes into MATTER.md.

Before editing MATTER.md, read the current file. Make the smallest useful edit. Prefer short summaries plus source pointers over copied source text. Keep the file concise, roughly under 500 lines. Before finishing, save durable changes and report material MATTER.md changes to the user. Do not claim MATTER.md is synced unless the harness confirms the save succeeded.`;

export interface MatterMdState {
	path: string;
	content: string;
	vault?: LincVaultRef;
}

export interface MatterMdInitializationAnswers {
	title: string;
	representation?: string;
	goal?: string;
	sourceRules?: string;
	openQuestions?: string;
}

export type MatterMdInitializationDecision = "initialized" | "skipped";

export interface MatterMdEntryData {
	vaultId: string;
	decision: MatterMdInitializationDecision;
}

export type MatterMdSourcePrecedence = "workspace-first" | "vault-first";

export interface MatterMdMaterializeOptions {
	sourcePrecedence?: MatterMdSourcePrecedence;
}

export function getMatterMdPath(ctx: ExtensionContext): string {
	return join(ctx.cwd, MATTER_MD_FILENAME);
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMatterMdEntryData(value: unknown): MatterMdEntryData | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.vaultId !== "string" || value.vaultId.length === 0) return undefined;
	if (value.decision !== "initialized" && value.decision !== "skipped") return undefined;
	return { vaultId: value.vaultId, decision: value.decision };
}

export function getMatterMdInitializationDecision(
	sessionManager: ReadonlySessionManager,
	vaultId: string,
): MatterMdInitializationDecision | undefined {
	const entries = sessionManager.getEntries();
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.type !== "custom" || entry.customType !== LINC_MATTER_MD_ENTRY_TYPE) continue;
		const data = readMatterMdEntryData(entry.data);
		if (data?.vaultId === vaultId) return data.decision;
	}
	return undefined;
}

function findMatterMdObject(records: CaseDevVaultObjectRecord[]): CaseDevVaultObjectRecord | undefined {
	return records.find((record) => {
		const names = [record.filename, record.name, record.path].filter((name): name is string => name !== undefined);
		return names.some((name) => basename(name) === MATTER_MD_FILENAME);
	});
}

async function downloadMatterMdFromVault(ctx: ExtensionContext, vault: LincVaultRef): Promise<string | undefined> {
	const matterObject = findMatterMdObject(await listCaseDevVaultObjects(ctx, vault.id));
	if (!matterObject) return undefined;

	const outDir = await mkdtemp(join(tmpdir(), "linc-matter-md-"));
	try {
		await downloadCaseDevVaultObject(ctx, {
			vaultId: vault.id,
			objectId: matterObject.id,
			outDir,
			filename: MATTER_MD_FILENAME,
		});

		const downloadedPath = join(outDir, MATTER_MD_FILENAME);
		if (!(await fileExists(downloadedPath))) {
			throw new Error(`Downloaded ${MATTER_MD_FILENAME} from Case.dev vault but it was not returned by the CLI.`);
		}

		return readFile(downloadedPath, "utf-8");
	} finally {
		await rm(outDir, { recursive: true, force: true });
	}
}

function escapeYamlString(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function buildStarterMatterMd(vault: LincVaultRef, answers: MatterMdInitializationAnswers): string {
	const representation = answers.representation?.trim();
	const goal = answers.goal?.trim();
	const sourceRules = answers.sourceRules?.trim();
	const openQuestions = answers.openQuestions?.trim();
	return `---
mattermd: "0.1"
title: "${escapeYamlString(answers.title.trim() || vault.name)}"
---

# Matter

## What This Is

## Representation

${representation ?? ""}

## Goals

${goal ?? ""}

## Jurisdiction

## Source Rules

${sourceRules ?? ""}

## Working Preferences

## Source Map

| Label | Source | Notes |
|---|---|---|

## Working State

## Open Questions

| Question | Why It Matters | Status |
|---|---|---|
${openQuestions ? `| ${openQuestions.replaceAll("|", "\\|")} | Initial matter setup | Open |` : ""}

## Board

| Status | Task | Notes |
|---|---|---|
`;
}

function isRootMatterMdPath(cwd: string, path: string | undefined): boolean {
	if (!path) return false;
	const absolutePath = resolve(cwd, path);
	const relativePath = relative(cwd, absolutePath);
	return relativePath === MATTER_MD_FILENAME && basename(absolutePath) === MATTER_MD_FILENAME;
}

function getToolPath(event: ToolResultEvent): string | undefined {
	const path = event.input.path;
	return typeof path === "string" ? path : undefined;
}

export async function readMatterMd(ctx: ExtensionContext): Promise<MatterMdState | undefined> {
	const path = getMatterMdPath(ctx);
	if (!(await fileExists(path))) return undefined;
	return {
		path,
		content: await readFile(path, "utf-8"),
		vault: getAttachedVault(ctx.sessionManager),
	};
}

export async function materializeMatterMd(
	ctx: ExtensionContext,
	options?: MatterMdMaterializeOptions,
): Promise<MatterMdState | undefined> {
	const path = getMatterMdPath(ctx);
	const vault = getAttachedVault(ctx.sessionManager);
	const sourcePrecedence = options?.sourcePrecedence ?? "workspace-first";

	if (vault && sourcePrecedence === "vault-first") {
		const vaultContent = await downloadMatterMdFromVault(ctx, vault);
		if (!vaultContent) {
			setMatterMdStatus(ctx, undefined);
			return undefined;
		}
		await writeFile(path, vaultContent, "utf-8");
		const state = await readMatterMd(ctx);
		setMatterMdStatus(ctx, state);
		return state;
	}

	if (await fileExists(path)) {
		const state = await readMatterMd(ctx);
		setMatterMdStatus(ctx, state);
		return state;
	}

	if (!vault) {
		setMatterMdStatus(ctx, undefined);
		return undefined;
	}

	const vaultContent = await downloadMatterMdFromVault(ctx, vault);
	if (!vaultContent) return undefined;
	await writeFile(path, vaultContent, "utf-8");

	const state = await readMatterMd(ctx);
	setMatterMdStatus(ctx, state);
	return state;
}

export async function initializeMatterMd(
	ctx: ExtensionContext,
	answers: MatterMdInitializationAnswers,
): Promise<MatterMdState> {
	const vault = getAttachedVault(ctx.sessionManager);
	if (!vault) {
		throw new Error("No Case.dev vault attached. Attach a vault before initializing MATTER.md.");
	}

	await writeMatterMdContent(ctx, buildStarterMatterMd(vault, answers));
	const state = await readMatterMd(ctx);
	if (!state) throw new Error("Failed to initialize MATTER.md at the workspace root.");
	return state;
}

export async function writeMatterMdContent(ctx: ExtensionContext, content: string): Promise<string> {
	await writeFile(getMatterMdPath(ctx), content, "utf-8");
	return syncMatterMdToVault(ctx);
}

export async function syncMatterMdToVault(ctx: ExtensionContext): Promise<string> {
	const vault = getAttachedVault(ctx.sessionManager);
	if (!vault) {
		throw new Error("No Case.dev vault attached. Run /vault attach <vault-id> before syncing MATTER.md.");
	}

	const path = getMatterMdPath(ctx);
	if (!(await fileExists(path))) {
		throw new Error("No MATTER.md found at the workspace root.");
	}

	const result = await uploadCaseDevVaultFile(ctx, {
		vaultId: vault.id,
		filePath: path,
		name: MATTER_MD_FILENAME,
		contentType: "text/markdown",
		ingest: false,
	});
	setMatterMdStatus(ctx, await readMatterMd(ctx));
	return JSON.stringify(result, null, 2);
}

export function setMatterMdStatus(ctx: ExtensionContext, state: MatterMdState | undefined): void {
	ctx.ui.setStatus(MATTER_MD_STATUS_KEY, state?.vault ? "matter: MATTER.md" : undefined);
}

export function buildMatterMdSystemPrompt(state: MatterMdState): string {
	return [
		"# MATTER.md Durable Matter Context",
		USING_MATTER_MD_GUIDANCE,
		"",
		`Loaded from: ${state.path}`,
		state.vault ? `Attached vault: ${state.vault.name} (${state.vault.id})` : undefined,
		"",
		"```markdown",
		state.content,
		"```",
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

export async function syncMatterMdToolResult(
	ctx: ExtensionContext,
	event: ToolResultEvent,
): Promise<ToolResultEventResult | undefined> {
	if (event.isError) return undefined;
	if (event.toolName !== "write" && event.toolName !== "edit") return undefined;
	if (!isRootMatterMdPath(ctx.cwd, getToolPath(event))) return undefined;

	try {
		const output = await syncMatterMdToVault(ctx);
		return {
			content: [...event.content, { type: "text", text: `MATTER.md synced to Case.dev vault.\n${output}` }],
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [
				...event.content,
				{
					type: "text",
					text: `MATTER.md was updated locally but did not sync to Case.dev vault: ${message}`,
				},
			],
			isError: true,
		};
	}
}
