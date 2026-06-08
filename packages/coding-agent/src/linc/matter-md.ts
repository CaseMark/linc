import { access, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import type { ExtensionContext, ToolResultEvent, ToolResultEventResult } from "../core/extensions/types.ts";
import { formatCaseDevCliResult, runCaseDevCli } from "./casedev-cli.ts";
import { getAttachedVault, type LincVaultRef } from "./vault-attachment.ts";

export const MATTER_MD_FILENAME = "MATTER.md";

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

function getMatterMdPath(ctx: ExtensionContext): string {
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

function buildStarterMatterMd(vault: LincVaultRef): string {
	return `---
mattermd: "0.1"
title: "${vault.name.replaceAll('"', '\\"')}"
---

# Matter

## What This Is

## Representation

## Goals

## Jurisdiction

## Source Rules

## Working Preferences

## Source Map

| Label | Source | Notes |
|---|---|---|

## Working State

## Open Questions

| Question | Why It Matters | Status |
|---|---|---|

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

export async function materializeMatterMd(ctx: ExtensionContext): Promise<MatterMdState | undefined> {
	const path = getMatterMdPath(ctx);
	const vault = getAttachedVault(ctx.sessionManager);

	if (await fileExists(path)) {
		const state = await readMatterMd(ctx);
		setMatterMdStatus(ctx, state);
		return state;
	}

	if (!vault) {
		setMatterMdStatus(ctx, undefined);
		return undefined;
	}

	if (!(await fileExists(path))) {
		await writeFile(path, buildStarterMatterMd(vault), "utf-8");
		await syncMatterMdToVault(ctx);
	}

	const state = await readMatterMd(ctx);
	setMatterMdStatus(ctx, state);
	return state;
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

	const result = await runCaseDevCli(
		ctx,
		[
			"vault",
			"object",
			"upload",
			path,
			"--vault",
			vault.id,
			"--name",
			MATTER_MD_FILENAME,
			"--content-type",
			"text/markdown",
			"--no-ingest",
		],
		ctx.signal,
	);
	setMatterMdStatus(ctx, await readMatterMd(ctx));
	return formatCaseDevCliResult(result);
}

export function setMatterMdStatus(ctx: ExtensionContext, state: MatterMdState | undefined): void {
	ctx.ui.setStatus(MATTER_MD_STATUS_KEY, state ? "matter: MATTER.md" : undefined);
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
