import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionCommandContext, ExtensionContext, ExtensionFactory } from "../core/extensions/types.ts";
import {
	findVaultByOption,
	formatVaultOption,
	loadCaseDevVault,
	loadCaseDevVaults,
	toLincVaultRef,
} from "./casedev-vaults.ts";
import {
	buildMatterMdSystemPrompt,
	getMatterMdInitializationDecision,
	initializeMatterMd,
	LINC_MATTER_MD_ENTRY_TYPE,
	type MatterMdInitializationAnswers,
	type MatterMdSourcePrecedence,
	materializeMatterMd,
	readMatterMd,
	setMatterMdStatus,
	syncMatterMdToolResult,
	syncMatterMdToVault,
	writeMatterMdContent,
} from "./matter-md.ts";
import { createMatterMdTools } from "./matter-md-tools.ts";
import { formatVaultRef, getAttachedVault, LINC_VAULT_ENTRY_TYPE, type LincVaultRef } from "./vault-attachment.ts";

const LINC_VAULT_STATUS_KEY = "linc.vault";
const LINC_LINC_DIR = dirname(fileURLToPath(import.meta.url));
const MATTER_INIT_SKILL_PATH = join(LINC_LINC_DIR, "skills", "matter-init", "SKILL.md");

function setVaultStatus(ctx: ExtensionContext, vault = getAttachedVault(ctx.sessionManager)): void {
	ctx.ui.setStatus(LINC_VAULT_STATUS_KEY, vault ? `vault: ${vault.name}` : undefined);
}

function buildVaultSystemPrompt(vault: LincVaultRef): string {
	return [
		"# Case.dev Vault",
		`This Linc session is attached to Case.dev vault ${formatVaultRef(vault)}.`,
		"Use the Case.dev vault tools against this attached vault unless the user explicitly names another vault.",
	].join("\n");
}

function normalizeOptionalAnswer(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

async function loadMatterInitSkill(): Promise<string> {
	return readFile(MATTER_INIT_SKILL_PATH, "utf-8");
}

async function buildMatterInitPrompt(ctx: ExtensionCommandContext, notes: string): Promise<string> {
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

export function createLincExtension(): ExtensionFactory {
	return (pi) => {
		for (const tool of createMatterMdTools()) {
			pi.registerTool(tool);
		}

		const promptMatterMdInitialization = async (
			ctx: ExtensionContext,
			vault: LincVaultRef,
		): Promise<MatterMdInitializationAnswers | undefined> => {
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
		};

		const ensureMatterMd = async (
			ctx: ExtensionContext,
			options?: { sourcePrecedence?: MatterMdSourcePrecedence; promptForMissing: boolean },
		) => {
			const matter = await materializeMatterMd(ctx, { sourcePrecedence: options?.sourcePrecedence });
			if (matter) return matter;

			const vault = getAttachedVault(ctx.sessionManager);
			if (!vault || !ctx.hasUI || !options?.promptForMissing) return undefined;
			if (getMatterMdInitializationDecision(ctx.sessionManager, vault.id) !== undefined) return undefined;

			const answers = await promptMatterMdInitialization(ctx, vault);
			if (!answers) {
				pi.appendEntry(LINC_MATTER_MD_ENTRY_TYPE, { vaultId: vault.id, decision: "skipped" });
				ctx.ui.notify("Skipped MATTER.md initialization", "info");
				return undefined;
			}

			const initialized = await initializeMatterMd(ctx, answers);
			pi.appendEntry(LINC_MATTER_MD_ENTRY_TYPE, { vaultId: vault.id, decision: "initialized" });
			ctx.ui.notify("Initialized MATTER.md and synced it to the attached Case.dev vault", "info");
			return initialized;
		};

		const attachVault = async (vault: LincVaultRef, ctx: ExtensionCommandContext) => {
			pi.appendEntry(LINC_VAULT_ENTRY_TYPE, { vault });
			setVaultStatus(ctx, vault);
			await ensureMatterMd(ctx, { sourcePrecedence: "vault-first", promptForMissing: true });
			ctx.ui.notify(`Attached vault: ${formatVaultRef(vault)}`, "info");
		};

		const clearVault = (ctx: ExtensionCommandContext) => {
			pi.appendEntry(LINC_VAULT_ENTRY_TYPE, {});
			setVaultStatus(ctx, undefined);
			setMatterMdStatus(ctx, undefined);
			ctx.ui.notify("Cleared attached vault", "info");
		};

		const showMatterMd = async (ctx: ExtensionCommandContext) => {
			const matter = await readMatterMd(ctx);
			if (!matter) {
				const vault = getAttachedVault(ctx.sessionManager);
				ctx.ui.notify(
					vault ? "No MATTER.md is loaded. Run /init or /matter edit to create one." : "No vault is attached.",
					"warning",
				);
				return;
			}
			ctx.ui.notify(
				matter.vault
					? `MATTER.md: ${matter.path} · vault: ${formatVaultRef(matter.vault)}`
					: `MATTER.md: ${matter.path}`,
				"info",
			);
		};

		const editMatterMd = async (ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) {
				throw new Error("/matter edit requires an interactive session.");
			}
			if (!getAttachedVault(ctx.sessionManager)) {
				ctx.ui.notify("Attach a Case.dev vault before editing MATTER.md", "warning");
				return;
			}
			const matter = await ensureMatterMd(ctx, { sourcePrecedence: "workspace-first", promptForMissing: true });
			if (!matter) {
				ctx.ui.notify("No MATTER.md is available. Run /init to create one.", "warning");
				return;
			}

			const content = await ctx.ui.editor("Edit MATTER.md", matter.content);
			if (content === undefined || content === matter.content) return;
			await writeMatterMdContent(ctx, content);
			ctx.ui.notify("Saved MATTER.md and synced it to the attached Case.dev vault", "info");
		};

		const syncMatterMd = async (ctx: ExtensionCommandContext) => {
			await syncMatterMdToVault(ctx);
			ctx.ui.notify("Synced MATTER.md to the attached Case.dev vault", "info");
		};

		pi.on("session_start", async (_event, ctx) => {
			setVaultStatus(ctx);
			await ensureMatterMd(ctx, {
				sourcePrecedence: getAttachedVault(ctx.sessionManager) ? "vault-first" : "workspace-first",
				promptForMissing: true,
			});
		});

		pi.on("session_compact", async (_event, ctx) => {
			await ensureMatterMd(ctx, { promptForMissing: false });
		});

		pi.on("tool_result", async (event, ctx) => {
			return syncMatterMdToolResult(ctx, event);
		});

		pi.on("before_agent_start", async (event, ctx) => {
			const vault = getAttachedVault(ctx.sessionManager);
			if (!vault) return undefined;
			const matter = await readMatterMd(ctx);
			return {
				systemPrompt: [
					event.systemPrompt,
					buildVaultSystemPrompt(vault),
					matter ? buildMatterMdSystemPrompt(matter) : undefined,
				]
					.filter((section): section is string => section !== undefined)
					.join("\n\n"),
			};
		});

		pi.registerCommand("vault", {
			description: "Attach, show, or clear the active Case.dev vault",
			async handler(args, ctx) {
				const trimmed = args.trim();
				if (trimmed === "show") {
					const vault = getAttachedVault(ctx.sessionManager);
					ctx.ui.notify(vault ? `Attached vault: ${formatVaultRef(vault)}` : "No vault attached", "info");
					return;
				}

				if (trimmed === "clear" || trimmed === "detach" || trimmed === "unlink") {
					clearVault(ctx);
					return;
				}

				if (trimmed.startsWith("attach ")) {
					const vaultId = trimmed.slice("attach ".length).trim();
					if (!vaultId) throw new Error("Usage: /vault attach <vault-id>");
					await attachVault(toLincVaultRef(await loadCaseDevVault(ctx, vaultId)), ctx);
					return;
				}

				if (trimmed.length > 0) {
					await attachVault(toLincVaultRef(await loadCaseDevVault(ctx, trimmed)), ctx);
					return;
				}

				if (!ctx.hasUI) {
					throw new Error("Usage: /vault attach <vault-id>, /vault show, /vault clear, or /vault unlink");
				}

				const vaults = await loadCaseDevVaults(ctx);
				if (vaults.length === 0) {
					ctx.ui.notify("No Case.dev vaults found", "warning");
					return;
				}

				const selected = await ctx.ui.select("Attach Case.dev vault", vaults.map(formatVaultOption));
				if (!selected) return;
				const vault = findVaultByOption(vaults, selected);
				if (!vault) return;
				await attachVault(toLincVaultRef(vault), ctx);
			},
			getArgumentCompletions(argumentPrefix) {
				const prefix = argumentPrefix.trim();
				return ["show", "clear", "detach", "unlink", "attach"]
					.filter((value) => value.startsWith(prefix))
					.map((value) => ({ label: value, value }));
			},
		});

		pi.registerCommand("matter", {
			description: "Show, edit, or sync the active MATTER.md",
			async handler(args, ctx) {
				const trimmed = args.trim();
				if (trimmed === "" || trimmed === "show") {
					await showMatterMd(ctx);
					return;
				}

				if (trimmed === "edit") {
					await editMatterMd(ctx);
					return;
				}

				if (trimmed === "sync") {
					await syncMatterMd(ctx);
					return;
				}

				throw new Error("Usage: /matter, /matter edit, or /matter sync");
			},
			getArgumentCompletions(argumentPrefix) {
				const prefix = argumentPrefix.trim();
				return ["show", "edit", "sync"]
					.filter((value) => value.startsWith(prefix))
					.map((value) => ({ label: value, value }));
			},
		});

		pi.registerCommand("init", {
			description: "Start Linc's guided legal matter initialization",
			async handler(args, ctx) {
				if (!ctx.hasUI) {
					throw new Error("/init requires an interactive session.");
				}

				const vault = getAttachedVault(ctx.sessionManager);
				if (!vault) {
					ctx.ui.notify("Attach a Case.dev vault before running /init", "warning");
					return;
				}

				pi.sendUserMessage(await buildMatterInitPrompt(ctx, args.trim()));
			},
		});
	};
}
