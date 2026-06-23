import type { ExtensionContext } from "../core/extensions/types.ts";
import { type CaseDevVaultRecord, getCaseDevVault, listCaseDevVaults } from "./casedev-vault-api.ts";
import type { LincVaultRef } from "./vault-attachment.ts";

export type { CaseDevVaultRecord } from "./casedev-vault-api.ts";

export async function loadCaseDevVaults(ctx: ExtensionContext): Promise<CaseDevVaultRecord[]> {
	return listCaseDevVaults(ctx);
}

export async function loadCaseDevVault(ctx: ExtensionContext, vaultId: string): Promise<CaseDevVaultRecord> {
	return getCaseDevVault(ctx, vaultId);
}

export function toLincVaultRef(vault: CaseDevVaultRecord): LincVaultRef {
	return {
		id: vault.id,
		name: vault.name,
		totalObjects: vault.totalObjects,
	};
}

export function formatVaultOption(vault: CaseDevVaultRecord): string {
	const objectText = vault.totalObjects === undefined ? "" : ` · ${vault.totalObjects} objects`;
	return `${vault.name} · ${vault.id}${objectText}`;
}

export function findVaultByOption(vaults: CaseDevVaultRecord[], option: string): CaseDevVaultRecord | undefined {
	return vaults.find((vault) => formatVaultOption(vault) === option);
}
