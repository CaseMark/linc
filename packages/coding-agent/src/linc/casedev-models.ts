import type { Api, Model } from "@earendil-works/pi-ai";
import { CASEDEV_PROVIDER_ID, CASEMARK_CORE_PROVIDER_ID } from "./casedev-auth.ts";

const DEFAULT_CASEDEV_API_BASE_URL = "https://api.case.dev";
const MODEL_CATALOG_TIMEOUT_MS = 2500;

export function getCaseDevLlmBaseUrl(): string {
	const apiBaseUrl = (
		process.env.CASEDEV_API_BASE_URL ||
		process.env.CASEDEV_BASE_URL ||
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
	modalities?: unknown;
	context_window?: unknown;
	max_tokens?: unknown;
};

export type CaseDevModel = Model<"openai-completions">;

function isRecord(value: unknown): value is Record<string, unknown> {
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

/**
 * Gateway records publish `modalities.input` (AI Gateway upstreams); casemark
 * records publish capability tags. Either signal grants image input.
 */
function readInput(record: CaseDevModelRecord, tags: string[]): ("text" | "image")[] {
	const modalities = isRecord(record.modalities) ? record.modalities.input : undefined;
	const image = Array.isArray(modalities)
		? modalities.includes("image")
		: tags.includes("multimodal") || tags.includes("vision");
	return image ? ["text", "image"] : ["text"];
}

function readPricing(pricing: Record<string, unknown>): Model<Api>["cost"] {
	const perToken = (value: unknown) => (readNumber(value) ?? 0) * 1_000_000;
	return {
		input: perToken(pricing.input),
		output: perToken(pricing.output),
		// Published per model where caching is billed; absent means uncached pricing.
		cacheRead: perToken(pricing.input_cache_read),
		// The gateway bills no cache writes and publishes no such field.
		cacheWrite: 0,
	};
}

/**
 * The context window linc plans against, which is what auto-compaction and
 * the silent-overflow check compare usage to.
 *
 * The gateway publishes the model's real window and, where the upstream bills
 * long prompts at a higher rate, an `input_tiers` ladder whose first boundary
 * is the price cliff: OpenAI GPT-5.x/6 at 272k (2x input and 1.5x output for
 * the whole request), Gemini and Grok at 200k. Capping the planning window at
 * that boundary keeps every request under the cliff while the catalog keeps
 * saying what the model can physically accept.
 *
 * Only a two-tier ladder whose second tier costs more is a cliff. A flat ladder
 * changes nothing, and a longer ladder (qwen3-coder: 32k / 128k / rest) is
 * graded pricing with no single line worth compacting for, so it is ignored.
 */
export function effectiveContextWindow(contextWindow: number, pricing: Record<string, unknown>): number {
	const tiers = pricing.input_tiers;
	if (!Array.isArray(tiers) || tiers.length !== 2 || !isRecord(tiers[0]) || !isRecord(tiers[1])) {
		return contextWindow;
	}
	const boundary = readNumber(tiers[0].max);
	const baseCost = readNumber(tiers[0].cost);
	const longCost = readNumber(tiers[1].cost);
	if (boundary === undefined || boundary <= 0 || boundary >= contextWindow) return contextWindow;
	if (baseCost === undefined || longCost === undefined || longCost <= baseCost) return contextWindow;
	return boundary;
}

/**
 * Convert one catalog record. Records without a usable window or output cap are
 * dropped rather than given invented numbers: a model linc cannot plan against
 * is a catalog defect to surface, not to paper over.
 */
export function toCaseDevModel(record: CaseDevModelRecord, provider: string): CaseDevModel | undefined {
	if (typeof record.id !== "string" || !record.id) return undefined;
	if (record.type !== "language") return undefined;

	const contextWindow = readNumber(record.context_window);
	const maxTokens = readNumber(record.max_tokens);
	if (contextWindow === undefined || contextWindow <= 0 || maxTokens === undefined || maxTokens <= 0) {
		return undefined;
	}

	const tags = readTags(record.tags);
	const pricing = isRecord(record.pricing) ? record.pricing : {};

	return {
		id: record.id,
		name: typeof record.name === "string" && record.name ? record.name : record.id,
		api: "openai-completions",
		provider,
		baseUrl: getCaseDevLlmBaseUrl(),
		reasoning: tags.includes("reasoning"),
		input: readInput(record, tags),
		cost: readPricing(pricing),
		contextWindow: effectiveContextWindow(contextWindow, pricing),
		maxTokens,
		// The gateway fronts heterogeneous upstreams. pi upgrades the system prompt
		// to role "developer" for reasoning models, and sglang-served ones reject
		// that role outright; "system" is accepted by every upstream.
		compat: { supportsDeveloperRole: false },
	};
}

export function parseCaseDevModelsResponse(data: unknown, provider = CASEDEV_PROVIDER_ID): CaseDevModel[] {
	if (!isRecord(data)) return [];
	const response = data as CaseDevModelListResponse;
	if (!Array.isArray(response.data)) return [];

	const models: CaseDevModel[] = [];
	for (const item of response.data) {
		if (!isRecord(item)) continue;
		const model = toCaseDevModel(item, provider);
		if (model) {
			models.push(model);
		}
	}
	return models;
}

/**
 * Fetch the live gateway catalog. Preview deployments sit behind Vercel
 * protection; the sandbox env carries the bypass secret.
 */
export async function fetchCaseDevModels(fetchFn: typeof fetch = fetch): Promise<CaseDevModel[]> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), MODEL_CATALOG_TIMEOUT_MS);
	const headers: Record<string, string> = {};
	if (process.env.CASEDEV_VERCEL_PROTECTION_BYPASS) {
		headers["x-vercel-protection-bypass"] = process.env.CASEDEV_VERCEL_PROTECTION_BYPASS;
	}
	try {
		const response = await fetchFn(`${getCaseDevLlmBaseUrl()}/models`, { headers, signal: controller.signal });
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		return parseCaseDevModelsResponse(await response.json());
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * Packaged fallback for PI_OFFLINE=1 and for a failed catalog fetch. Values
 * mirror the live catalog (core-mini: sglang --context-length 262144, 32k out).
 */
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
		compat: { supportsDeveloperRole: false },
	},
	{
		id: "casemark/core-mini",
		name: "CaseMark Core Mini",
		api: "openai-completions",
		provider: CASEMARK_CORE_PROVIDER_ID,
		baseUrl: getCaseDevLlmBaseUrl(),
		reasoning: true,
		input: ["text"],
		cost: { input: 2, output: 6, cacheRead: 0.1, cacheWrite: 0 },
		contextWindow: 262144,
		maxTokens: 32000,
		compat: { supportsDeveloperRole: false },
	},
] satisfies CaseDevModel[];

export const DEFAULT_CASEDEV_MODELS = CASEMARK_CORE_MODELS.map((model) => ({
	...model,
	provider: CASEDEV_PROVIDER_ID,
})) satisfies CaseDevModel[];
