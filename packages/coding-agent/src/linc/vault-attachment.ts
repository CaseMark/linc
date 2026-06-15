import type { ReadonlySessionManager } from "../core/session-manager.ts";

export const LINC_VAULT_ENTRY_TYPE = "linc.vault";

export interface LincVaultRef {
	id: string;
	name: string;
	totalObjects?: number;
}

export interface LincVaultEntryData {
	vault?: LincVaultRef;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readVaultRef(value: unknown): LincVaultRef | undefined {
	if (!isRecord(value)) return undefined;
	const id = value.id;
	const name = value.name;
	if (typeof id !== "string" || id.length === 0) return undefined;
	if (typeof name !== "string" || name.length === 0) return undefined;
	const totalObjects = typeof value.totalObjects === "number" ? value.totalObjects : undefined;
	return { id, name, totalObjects };
}

export function getAttachedVault(sessionManager: ReadonlySessionManager): LincVaultRef | undefined {
	const entries = sessionManager.getEntries();
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.type !== "custom" || entry.customType !== LINC_VAULT_ENTRY_TYPE) continue;
		if (!isRecord(entry.data)) return undefined;
		return readVaultRef(entry.data.vault);
	}
	return undefined;
}

export function formatVaultRef(vault: LincVaultRef): string {
	const objectText = vault.totalObjects === undefined ? "" : `, ${vault.totalObjects} objects`;
	return `${vault.name} (${vault.id}${objectText})`;
}
