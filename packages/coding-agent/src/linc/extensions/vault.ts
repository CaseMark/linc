import type { ExtensionCommandContext, ExtensionContext, ExtensionFactory } from "../../core/extensions/types.ts";
import {
	findVaultByOption,
	formatVaultOption,
	loadCaseDevVault,
	loadCaseDevVaults,
	toLincVaultRef,
} from "../casedev-vaults.ts";
import { setMatterMdStatus } from "../matter-md.ts";
import { formatVaultRef, getAttachedVault, LINC_VAULT_ENTRY_TYPE, type LincVaultRef } from "../vault-attachment.ts";
import { ensureMatterMd } from "./matter-session.ts";

const LINC_VAULT_STATUS_KEY = "linc.vault";

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

const vaultExtension: ExtensionFactory = (pi) => {
	const attachVault = async (vault: LincVaultRef, ctx: ExtensionCommandContext) => {
		pi.appendEntry(LINC_VAULT_ENTRY_TYPE, { vault });
		setVaultStatus(ctx, vault);
		await ensureMatterMd(pi, ctx, { sourcePrecedence: "vault-first", promptForMissing: true });
		ctx.ui.notify(`Attached vault: ${formatVaultRef(vault)}`, "info");
		await ctx.reload();
	};

	const clearVault = (ctx: ExtensionContext) => {
		pi.appendEntry(LINC_VAULT_ENTRY_TYPE, {});
		setVaultStatus(ctx, undefined);
		setMatterMdStatus(ctx, undefined);
		ctx.ui.notify("Cleared attached vault", "info");
	};

	pi.on("session_start", async (_event, ctx) => {
		setVaultStatus(ctx);
	});

	pi.on("before_agent_start", (event, ctx) => {
		const vault = getAttachedVault(ctx.sessionManager);
		if (!vault) return undefined;
		return {
			systemPrompt: [event.systemPrompt, buildVaultSystemPrompt(vault)].join("\n\n"),
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
};

export default vaultExtension;
