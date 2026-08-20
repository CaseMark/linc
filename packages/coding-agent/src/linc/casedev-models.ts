import type { Api, Model } from "@earendil-works/pi-ai";
import { CASEDEV_PROVIDER_ID, CASEMARK_CORE_PROVIDER_ID } from "./casedev-auth.ts";

const DEFAULT_CASEDEV_API_BASE_URL = "https://api.case.dev";
const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 16384;
const MODEL_CATALOG_TIMEOUT_MS = 2500;

export function getCaseDevLlmBaseUrl(): string {
	const apiBaseUrl = (
		process.env.CASEDEV_API_BASE_URL ||
		process.env.CASE_API_URL ||
		DEFAULT_CASEDEV_API_BASE_URL
	).replace(/\/$/, "");
	return (process.env.CASEDEV_LLM_BASE_URL || `${apiBaseUrl}/llm/v1`).replace(/\/$/, "");
}

type CaseDevModelListResponse = {
	object?: "list";
	data?: unknown[];
};

type CaseDevModelRecord = {
	id?: unknown;
	name?: unknown;
	type?: unknown;
	tags?: unknown;
	pricing?: unknown;
	context_window?: unknown;
	max_tokens?: unknown;
};

function isCaseDevModelRecord(value: unknown): value is CaseDevModelRecord {
	return typeof value === "object" && value !== null;
}

function readNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

function readTags(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((tag): tag is string => typeof tag === "string");
}

function readPricing(value: unknown): Model<Api>["cost"] {
	const pricing: Record<string, unknown> =
		typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
	const input = readNumber(pricing.input);
	const output = readNumber(pricing.output);
	// Published per-model where caching is billed (e.g. core-mini prefix-cache
	// hits at $0.10/MTok, CD-1429). The gateway does not bill cache writes and
	// publishes no such field.
	const cacheRead = readNumber(pricing.input_cache_read);
	return {
		input: input === undefined ? 0 : input * 1_000_000,
		output: output === undefined ? 0 : output * 1_000_000,
		cacheRead: cacheRead === undefined ? 0 : cacheRead * 1_000_000,
		cacheWrite: 0,
	};
}

function toCaseDevModel(record: CaseDevModelRecord, provider: string): Model<Api> | undefined {
	if (typeof record.id !== "string" || !record.id) return undefined;
	if (record.type !== "language") return undefined;

	const tags = readTags(record.tags);
	const maxTokens = readNumber(record.max_tokens) ?? DEFAULT_MAX_TOKENS;
	if (maxTokens <= 0) return undefined;
	// Same guard as maxTokens: a zero/negative published window would trip the
	// silent-overflow compact-and-retry heuristic on every successful response.
	// Absent falls back to the default; present and non-positive is unusable.
	const publishedWindow = readNumber(record.context_window);
	if (publishedWindow !== undefined && publishedWindow <= 0) return undefined;
	const contextWindow = publishedWindow ?? DEFAULT_CONTEXT_WINDOW;

	return {
		id: record.id,
		name: typeof record.name === "string" && record.name ? record.name : record.id,
		api: "openai-completions",
		provider,
		baseUrl: getCaseDevLlmBaseUrl(),
		reasoning: tags.includes("reasoning"),
		input: tags.includes("multimodal") || tags.includes("vision") ? ["text", "image"] : ["text"],
		cost: readPricing(record.pricing),
		contextWindow,
		maxTokens,
	};
}

/**
 * Per-model adjustments a consumer needs on top of the parsed catalog —
 * e.g. the sandbox extension pins compat.supportsDeveloperRole=false because
 * the gateway fronts heterogeneous upstreams and sglang-served models reject
 * the "developer" role. Exported so external registrars (the casedev sandbox
 * extension) can reuse THIS parser instead of mirroring it.
 */
export type CaseDevModelOverrides = {
	compat?: Model<Api>["compat"];
};

export function parseCaseDevModelsResponse(
	data: unknown,
	provider = CASEDEV_PROVIDER_ID,
	overrides?: CaseDevModelOverrides,
): Model<Api>[] {
	if (!isCaseDevModelRecord(data)) return [];
	const response = data as CaseDevModelListResponse;
	if (!Array.isArray(response.data)) return [];

	const models: Model<Api>[] = [];
	for (const item of response.data) {
		if (!isCaseDevModelRecord(item)) continue;
		const model = toCaseDevModel(item, provider);
		if (model) {
			models.push(overrides?.compat ? { ...model, compat: overrides.compat } : model);
		}
	}
	return models;
}

export async function fetchCaseDevModels(
	fetchFn: typeof fetch = fetch,
	overrides?: CaseDevModelOverrides,
): Promise<Model<Api>[]> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), MODEL_CATALOG_TIMEOUT_MS);
	try {
		const response = await fetchFn(`${getCaseDevLlmBaseUrl()}/models`, { signal: controller.signal });
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		return parseCaseDevModelsResponse(await response.json(), CASEDEV_PROVIDER_ID, overrides);
	} finally {
		clearTimeout(timeout);
	}
}

export const CASEMARK_CORE_MODELS = [
	{
		id: "casemark/core-large",
		name: "CaseMark Core Large",
		api: "openai-completions",
		provider: CASEMARK_CORE_PROVIDER_ID,
		baseUrl: getCaseDevLlmBaseUrl(),
		reasoning: true,
		input: ["text"],
		cost: { input: 5, output: 12, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 128000,
	},
	{
		id: "casemark/core-mini",
		name: "CaseMark Core Mini",
		api: "openai-completions",
		provider: CASEMARK_CORE_PROVIDER_ID,
		baseUrl: getCaseDevLlmBaseUrl(),
		reasoning: true,
		input: ["text"],
		cost: { input: 2, output: 6, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 32000,
	},
] satisfies Model<"openai-completions">[];

export const DEFAULT_CASEDEV_MODELS = CASEMARK_CORE_MODELS.map((model) => ({
	...model,
	provider: CASEDEV_PROVIDER_ID,
})) satisfies Model<"openai-completions">[];
