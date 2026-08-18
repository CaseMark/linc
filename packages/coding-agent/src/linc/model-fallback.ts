import type { Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "../core/model-registry.ts";
import type { ReadonlySessionManager } from "../core/session-manager.ts";
import { CASEDEV_PROVIDER_ID, CASEMARK_CORE_PROVIDER_ID } from "./casedev-auth.ts";

export const LINC_MODEL_FALLBACK_ENTRY_TYPE = "linc.model-fallback";
export const DEFAULT_FALLBACK_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_PRIMARY_MODEL_ID = "casemark/core-potassium";
export const DEFAULT_FALLBACK_MODEL_ID = "casemark/core-lightning-pro";
export const FALLBACK_STATUS_CODES = new Set([429, 500, 502, 503, 504, 529]);

export type ModelFallbackState = {
	originalProvider: string;
	originalModelId: string;
	fallbackProvider: string;
	fallbackModelId: string;
	restoreAt: number;
	restored?: boolean;
	cancelled?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function isFallbackStatus(status: number): boolean {
	return FALLBACK_STATUS_CODES.has(status);
}

export function getFallbackTtlMs(env: NodeJS.ProcessEnv = process.env): number {
	const raw = env.LINC_MODEL_FALLBACK_TTL_MS?.trim();
	if (!raw) return DEFAULT_FALLBACK_TTL_MS;
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FALLBACK_TTL_MS;
}

export function getFallbackModelId(env: NodeJS.ProcessEnv = process.env): string {
	return env.LINC_MODEL_FALLBACK_MODEL?.trim() || DEFAULT_FALLBACK_MODEL_ID;
}

export function isPrimaryFallbackSource(model: Pick<Model<string>, "id">): boolean {
	return model.id.toLowerCase() === DEFAULT_PRIMARY_MODEL_ID || model.id.toLowerCase().endsWith("/core-potassium");
}

export function parseModelFallbackState(value: unknown): ModelFallbackState | undefined {
	if (!isRecord(value)) return undefined;
	const originalProvider = readString(value.originalProvider);
	const originalModelId = readString(value.originalModelId);
	const fallbackProvider = readString(value.fallbackProvider);
	const fallbackModelId = readString(value.fallbackModelId);
	const restoreAt = readNumber(value.restoreAt);
	if (!originalProvider || !originalModelId || !fallbackProvider || !fallbackModelId || restoreAt === undefined) {
		return undefined;
	}
	return {
		originalProvider,
		originalModelId,
		fallbackProvider,
		fallbackModelId,
		restoreAt,
		restored: value.restored === true,
		cancelled: value.cancelled === true,
	};
}

export function getActiveModelFallback(sessionManager: ReadonlySessionManager): ModelFallbackState | undefined {
	const entries = sessionManager.getEntries();
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.type !== "custom" || entry.customType !== LINC_MODEL_FALLBACK_ENTRY_TYPE) continue;
		return parseModelFallbackState(entry.data);
	}
	return undefined;
}

export function resolveFallbackModel(
	registry: Pick<ModelRegistry, "find">,
	currentProvider: string,
	fallbackModelId: string,
): Model<string> | undefined {
	return (
		registry.find(currentProvider, fallbackModelId) ??
		registry.find(CASEDEV_PROVIDER_ID, fallbackModelId) ??
		registry.find(CASEMARK_CORE_PROVIDER_ID, fallbackModelId)
	);
}
