import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "../../core/extensions/types.ts";
import {
	getMatterMdInitializationDecision,
	initializeMatterMd,
	LINC_MATTER_MD_ENTRY_TYPE,
	type MatterMdInitializationAnswers,
	type MatterMdSourcePrecedence,
	materializeMatterMd,
	readMatterMd,
	syncMatterMdToVault,
	writeMatterMdContent,
} from "../matter-md.ts";
import { formatVaultRef, getAttachedVault } from "../vault-attachment.ts";

const LINC_EXTENSIONS_DIR = dirname(fileURLToPath(import.meta.url));
const LINC_DIR = dirname(LINC_EXTENSIONS_DIR);
const MATTER_INIT_SKILL_PATH = join(LINC_DIR, "skills", "matter-init", "SKILL.md");

function normalizeOptionalAnswer(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

async function loadMatterInitSkill(): Promise<string> {
	return readFile(MATTER_INIT_SKILL_PATH, "utf-8");
}

async function promptMatterMdInitialization(ctx: ExtensionContext): Promise<MatterMdInitializationAnswers | undefined> {
	const vault = getAttachedVault(ctx.sessionManager);
	if (!vault) return undefined;

	const shouldInitialize = await ctx.ui.confirm(
		"Initialize MATTER.md",
		`${formatVaultRef(vault)} does not have MATTER.md yet. Create durable matter context now?`,
		{ signal: ctx.signal },
	);
	if (!shouldInitialize) return undefined;

	const title = normalizeOptionalAnswer(await ctx.ui.input("Matter title", vault.name, { signal: ctx.signal }));
	const representation = normalizeOptionalAnswer(
		await ctx.ui.input("Who do we represent?", "Client, party, or role", { signal: ctx.signal }),
	);
	const goal = normalizeOptionalAnswer(
		await ctx.ui.input("Immediate goal", "What should Linc optimize for in this matter?", {
			signal: ctx.signal,
		}),
	);
	const sourceRules = normalizeOptionalAnswer(
		await ctx.ui.input("Source rules", "Citation, privilege, source-of-truth, or evidence rules", {
			signal: ctx.signal,
		}),
	);
	const openQuestions = normalizeOptionalAnswer(
		await ctx.ui.input("Open questions", "One durable open question or task", { signal: ctx.signal }),
	);

	return {
		title: title ?? vault.name,
		representation,
		goal,
		sourceRules,
		openQuestions,
	};
}

export async function ensureMatterMd(
	pi: Pick<ExtensionAPI, "appendEntry">,
	ctx: ExtensionContext,
	options?: { sourcePrecedence?: MatterMdSourcePrecedence; promptForMissing: boolean },
) {
	const matter = await materializeMatterMd(ctx, { sourcePrecedence: options?.sourcePrecedence });
	if (matter) return matter;

	const vault = getAttachedVault(ctx.sessionManager);
	if (!vault || !ctx.hasUI || !options?.promptForMissing) return undefined;
	if (getMatterMdInitializationDecision(ctx.sessionManager, vault.id) !== undefined) return undefined;

	const answers = await promptMatterMdInitialization(ctx);
	if (!answers) {
		pi.appendEntry(LINC_MATTER_MD_ENTRY_TYPE, { vaultId: vault.id, decision: "skipped" });
		ctx.ui.notify("Skipped MATTER.md initialization", "info");
		return undefined;
	}

	const initialized = await initializeMatterMd(ctx, answers);
	pi.appendEntry(LINC_MATTER_MD_ENTRY_TYPE, { vaultId: vault.id, decision: "initialized" });
	ctx.ui.notify("Initialized MATTER.md and synced it to the attached Case.dev vault", "info");
	return initialized;
}

export async function buildMatterInitPrompt(ctx: ExtensionCommandContext, notes: string): Promise<string> {
	const vault = getAttachedVault(ctx.sessionManager);
	const matter = await readMatterMd(ctx);
	const skill = await loadMatterInitSkill();
	return [
		"# Linc Matter Initialization",
		"",
		"Run the bundled Linc matter initialization skill below.",
		"",
		vault ? `Attached vault: ${formatVaultRef(vault)}` : "No Case.dev vault is attached.",
		matter ? `Current MATTER.md path: ${matter.path}` : "No MATTER.md is currently loaded.",
		notes ? `User notes: ${notes}` : undefined,
		"",
		"```markdown",
		skill.trim(),
		"```",
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

export async function buildMatterAutoInitPrompt(ctx: ExtensionCommandContext, notes: string): Promise<string> {
	const vault = getAttachedVault(ctx.sessionManager);
	const matter = await readMatterMd(ctx);
	const skill = await loadMatterInitSkill();
	return [
		"# Linc Matter Auto-Initialization",
		"",
		"Run an exploratory pass against the attached Case.dev vault and create or improve MATTER.md.",
		"",
		vault ? `Attached vault: ${formatVaultRef(vault)}` : "No Case.dev vault is attached.",
		matter ? `Current MATTER.md path: ${matter.path}` : "No MATTER.md is currently loaded.",
		notes ? `User notes: ${notes}` : undefined,
		"",
		"Instructions:",
		"- If MATTER.md exists, call casedev_matter_read first and preserve durable facts already present.",
		"- Inspect the vault with casedev_vault_get, casedev_vault_object_list, and a small set of targeted casedev_vault_search queries.",
		"- Create or update MATTER.md with casedev_matter_write or casedev_matter_edit.",
		"- Write UNKNOWN exactly where the vault does not support a durable answer.",
		"- Do not guess, infer beyond the sources, dump raw evidence, or store scratchpad reasoning.",
		"- Keep Source Map entries as concise pointers to vault object names or ids.",
		"- Ask the user only if auth, vault access, or missing source material blocks the exploratory run.",
		"",
		"Use the bundled Linc matter initialization skill below as the MATTER.md contract.",
		"",
		"```markdown",
		skill.trim(),
		"```",
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

export async function showMatterMd(ctx: ExtensionCommandContext): Promise<void> {
	const matter = await readMatterMd(ctx);
	if (!matter) {
		const vault = getAttachedVault(ctx.sessionManager);
		ctx.ui.notify(
			vault
				? "No MATTER.md is loaded. Run /init, /autoinit, or /matter edit to create one."
				: "No vault is attached.",
			"warning",
		);
		return;
	}
	ctx.ui.notify(
		matter.vault ? `MATTER.md: ${matter.path} · vault: ${formatVaultRef(matter.vault)}` : `MATTER.md: ${matter.path}`,
		"info",
	);
}

export async function editMatterMd(pi: Pick<ExtensionAPI, "appendEntry">, ctx: ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) {
		throw new Error("/matter edit requires an interactive session.");
	}
	if (!getAttachedVault(ctx.sessionManager)) {
		ctx.ui.notify("Attach a Case.dev vault before editing MATTER.md", "warning");
		return;
	}
	const matter = await ensureMatterMd(pi, ctx, { sourcePrecedence: "workspace-first", promptForMissing: true });
	if (!matter) {
		ctx.ui.notify("No MATTER.md is available. Run /init or /autoinit to create one.", "warning");
		return;
	}

	const content = await ctx.ui.editor("Edit MATTER.md", matter.content);
	if (content === undefined || content === matter.content) return;
	await writeMatterMdContent(ctx, content);
	ctx.ui.notify("Saved MATTER.md and synced it to the attached Case.dev vault", "info");
}

export async function syncMatterMd(ctx: ExtensionCommandContext): Promise<void> {
	await syncMatterMdToVault(ctx);
	ctx.ui.notify("Synced MATTER.md to the attached Case.dev vault", "info");
}
