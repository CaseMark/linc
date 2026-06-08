import type { ExtensionCommandContext, ExtensionContext, ExtensionFactory } from "../core/extensions/types.ts";
import { formatCaseDevCliResult, runCaseDevCli } from "./casedev-cli.ts";
import {
	buildMatterMdSystemPrompt,
	materializeMatterMd,
	readMatterMd,
	syncMatterMdToolResult,
	syncMatterMdToVault,
} from "./matter-md.ts";
import { formatVaultRef, getAttachedVault, LINC_VAULT_ENTRY_TYPE, type LincVaultRef } from "./vault-attachment.ts";

const LINC_VAULT_STATUS_KEY = "linc.vault";

interface CaseDevVaultRecord {
	id: string;
	name: string;
	totalObjects?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readVaultRecord(value: unknown): CaseDevVaultRecord | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.id !== "string" || value.id.length === 0) return undefined;
	if (typeof value.name !== "string" || value.name.length === 0) return undefined;
	return {
		id: value.id,
		name: value.name,
		totalObjects: typeof value.totalObjects === "number" ? value.totalObjects : undefined,
	};
}

function parseVaultList(text: string): CaseDevVaultRecord[] {
	const parsed = JSON.parse(text) as unknown;
	if (!isRecord(parsed) || !Array.isArray(parsed.vaults)) return [];
	return parsed.vaults.map(readVaultRecord).filter((vault): vault is CaseDevVaultRecord => vault !== undefined);
}

function parseVault(text: string): CaseDevVaultRecord {
	const vault = readVaultRecord(JSON.parse(text) as unknown);
	if (!vault) {
		throw new Error("Case.dev returned invalid vault metadata.");
	}
	return vault;
}

async function loadVaults(ctx: ExtensionCommandContext): Promise<CaseDevVaultRecord[]> {
	const result = await runCaseDevCli(ctx, ["vault", "list"], ctx.signal);
	return parseVaultList(formatCaseDevCliResult(result));
}

async function loadVault(ctx: ExtensionCommandContext, vaultId: string): Promise<CaseDevVaultRecord> {
	const result = await runCaseDevCli(ctx, ["vault", "get", vaultId], ctx.signal);
	return parseVault(formatCaseDevCliResult(result));
}

function toVaultRef(vault: CaseDevVaultRecord): LincVaultRef {
	return {
		id: vault.id,
		name: vault.name,
		totalObjects: vault.totalObjects,
	};
}

function formatVaultOption(vault: CaseDevVaultRecord): string {
	const objectText = vault.totalObjects === undefined ? "" : ` · ${vault.totalObjects} objects`;
	return `${vault.name} · ${vault.id}${objectText}`;
}

function findVaultByOption(vaults: CaseDevVaultRecord[], option: string): CaseDevVaultRecord | undefined {
	return vaults.find((vault) => formatVaultOption(vault) === option);
}

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

export function createLincExtension(): ExtensionFactory {
	return (pi) => {
		const attachVault = async (vault: LincVaultRef, ctx: ExtensionCommandContext) => {
			pi.appendEntry(LINC_VAULT_ENTRY_TYPE, { vault });
			setVaultStatus(ctx, vault);
			await materializeMatterMd(ctx);
			ctx.ui.notify(`Attached vault: ${formatVaultRef(vault)}`, "info");
		};

		const clearVault = (ctx: ExtensionCommandContext) => {
			pi.appendEntry(LINC_VAULT_ENTRY_TYPE, {});
			setVaultStatus(ctx, undefined);
			ctx.ui.notify("Cleared attached vault", "info");
		};

		pi.on("session_start", async (_event, ctx) => {
			setVaultStatus(ctx);
			await materializeMatterMd(ctx);
		});

		pi.on("session_compact", async (_event, ctx) => {
			await materializeMatterMd(ctx);
		});

		pi.on("tool_result", async (event, ctx) => {
			return syncMatterMdToolResult(ctx, event);
		});

		pi.on("before_agent_start", async (event, ctx) => {
			const vault = getAttachedVault(ctx.sessionManager);
			const matter = await readMatterMd(ctx);
			if (!vault && !matter) return undefined;
			return {
				systemPrompt: [
					event.systemPrompt,
					vault ? buildVaultSystemPrompt(vault) : undefined,
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

				if (trimmed === "clear") {
					clearVault(ctx);
					return;
				}

				if (trimmed.startsWith("attach ")) {
					const vaultId = trimmed.slice("attach ".length).trim();
					if (!vaultId) throw new Error("Usage: /vault attach <vault-id>");
					await attachVault(toVaultRef(await loadVault(ctx, vaultId)), ctx);
					return;
				}

				if (trimmed.length > 0) {
					await attachVault(toVaultRef(await loadVault(ctx, trimmed)), ctx);
					return;
				}

				if (!ctx.hasUI) {
					throw new Error("Usage: /vault attach <vault-id>, /vault show, or /vault clear");
				}

				const vaults = await loadVaults(ctx);
				if (vaults.length === 0) {
					ctx.ui.notify("No Case.dev vaults found", "warning");
					return;
				}

				const selected = await ctx.ui.select("Attach Case.dev vault", vaults.map(formatVaultOption));
				if (!selected) return;
				const vault = findVaultByOption(vaults, selected);
				if (!vault) return;
				await attachVault(toVaultRef(vault), ctx);
			},
			getArgumentCompletions(argumentPrefix) {
				const prefix = argumentPrefix.trim();
				return ["show", "clear", "attach"]
					.filter((value) => value.startsWith(prefix))
					.map((value) => ({ label: value, value }));
			},
		});

		pi.registerCommand("matter", {
			description: "Show, initialize, or sync the workspace MATTER.md",
			async handler(args, ctx) {
				const trimmed = args.trim();
				if (trimmed === "" || trimmed === "show") {
					const matter = await readMatterMd(ctx);
					ctx.ui.notify(matter ? `Loaded MATTER.md: ${matter.path}` : "No MATTER.md loaded", "info");
					return;
				}

				if (trimmed === "init") {
					const matter = await materializeMatterMd(ctx);
					ctx.ui.notify(
						matter ? `Loaded MATTER.md: ${matter.path}` : "Attach a Case.dev vault before initializing MATTER.md",
						"info",
					);
					return;
				}

				if (trimmed === "sync") {
					await syncMatterMdToVault(ctx);
					ctx.ui.notify("Synced MATTER.md to Case.dev vault", "info");
					return;
				}

				throw new Error("Usage: /matter, /matter show, /matter init, or /matter sync");
			},
			getArgumentCompletions(argumentPrefix) {
				const prefix = argumentPrefix.trim();
				return ["show", "init", "sync"]
					.filter((value) => value.startsWith(prefix))
					.map((value) => ({ label: value, value }));
			},
		});
	};
}
