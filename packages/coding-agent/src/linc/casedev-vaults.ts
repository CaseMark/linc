import type { ExtensionContext } from "../core/extensions/types.ts";
import { formatCaseDevCliResult, runCaseDevCli } from "./casedev-cli.ts";
import type { LincVaultRef } from "./vault-attachment.ts";

export interface CaseDevVaultRecord {
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
	if (!isRecord(parsed) || !Array.isArray(parsed.vaults)) {
		throw new Error("Case.dev returned invalid vault list metadata.");
	}
	return parsed.vaults.map(readVaultRecord).filter((vault): vault is CaseDevVaultRecord => vault !== undefined);
}

function parseVault(text: string): CaseDevVaultRecord {
	const vault = readVaultRecord(JSON.parse(text) as unknown);
	if (!vault) {
		throw new Error("Case.dev returned invalid vault metadata.");
	}
	return vault;
}

export async function loadCaseDevVaults(ctx: ExtensionContext): Promise<CaseDevVaultRecord[]> {
	const result = await runCaseDevCli(ctx, ["vault", "list"], ctx.signal);
	return parseVaultList(formatCaseDevCliResult(result));
}

export async function loadCaseDevVault(ctx: ExtensionContext, vaultId: string): Promise<CaseDevVaultRecord> {
	const result = await runCaseDevCli(ctx, ["vault", "get", vaultId], ctx.signal);
	return parseVault(formatCaseDevCliResult(result));
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
