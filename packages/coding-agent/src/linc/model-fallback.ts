import type { Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "../core/model-registry.ts";
import type { ReadonlySessionManager } from "../core/session-manager.ts";
import { CASEDEV_PROVIDER_ID, CASEMARK_CORE_PROVIDER_ID } from "./casedev-auth.ts";

export const LINC_MODEL_FALLBACK_ENTRY_TYPE = "linc.model-fallback";
export const DEFAULT_FALLBACK_TTL_MS = 10 * 60 * 1000;
/** Synthetic status for upstream stream/network failures that carry no HTTP status. */
export const STREAM_FAILURE_STATUS = 599;
/**
 * Ordered fallback chain. A failing model moves to the entry after it (core
 * models outside the chain enter at the top). The last entry is the terminal
 * fallback and never switches away: gpt-5.6-sol is served by OpenAI and does
 * not share an upstream with the casemark/core family.
 */
export const DEFAULT_FALLBACK_CHAIN = [
	"casemark/core-potassium",
	"casemark/core-lightning-pro",
	"openai/gpt-5.6-sol",
] as const;
export const FALLBACK_STATUS_CODES = new Set([429, 500, 502, 503, 504, 529, STREAM_FAILURE_STATUS]);

const CORE_FAMILY_PREFIX = "casemark/core-";

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

/**
 * The fallback chain, in order. `LINC_MODEL_FALLBACK_CHAIN` (comma-separated
 * model ids) replaces the whole chain; `LINC_MODEL_FALLBACK_MODEL` keeps its
 * original meaning as the single first-hop target before the terminal entry.
 */
export function getFallbackChain(env: NodeJS.ProcessEnv = process.env): string[] {
	const rawChain = env.LINC_MODEL_FALLBACK_CHAIN?.trim();
	if (rawChain) {
		const chain = rawChain
			.split(",")
			.map((id) => id.trim().toLowerCase())
			.filter((id) => id.length > 0);
		if (chain.length > 0) return chain;
	}
	const singleTarget = env.LINC_MODEL_FALLBACK_MODEL?.trim();
	if (singleTarget) {
		const target = singleTarget.toLowerCase();
		const terminal = DEFAULT_FALLBACK_CHAIN[DEFAULT_FALLBACK_CHAIN.length - 1];
		return target === terminal ? [target] : [target, terminal];
	}
	return [...DEFAULT_FALLBACK_CHAIN];
}

export function isCoreFamilyModel(modelId: string): boolean {
	return modelId.toLowerCase().startsWith(CORE_FAMILY_PREFIX);
}

/**
 * Next model id in the chain for a failing model, or undefined when there is
 * nowhere left to go (terminal entry, or a model we do not manage).
 */
export function getNextFallbackModelId(currentModelId: string, chain: string[]): string | undefined {
	if (chain.length === 0) return undefined;
	const current = currentModelId.toLowerCase();
	const index = chain.indexOf(current);
	if (index !== -1) {
		return index < chain.length - 1 ? chain[index + 1] : undefined;
	}
	if (!isCoreFamilyModel(current)) return undefined;
	return chain[0] === current ? chain[1] : chain[0];
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
