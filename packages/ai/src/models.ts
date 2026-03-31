import { getEnvApiKey, getEnvLlmBaseUrl } from "./env-api-keys.js";
import type { Api, Model, Usage } from "./types.js";

const modelRegistry: Map<string, Map<string, Model<Api>>> = new Map();
let modelsLoaded = false;

/**
 * Fetch available models from the configured OpenAI-compatible endpoint and populate the registry.
 * Must be called once at startup with either CORE_ACCESS_TOKEN or CASEDEV_API_KEY.
 */
export async function loadModels(apiKey?: string, baseUrl?: string): Promise<void> {
	const key = apiKey || getEnvApiKey();
	if (!key) {
		return;
	}
	const llmBaseUrl = (baseUrl || getEnvLlmBaseUrl(key)).replace(/\/+$/, "");

	try {
		const res = await fetch(`${llmBaseUrl}/models`, {
			headers: { Authorization: `Bearer ${key}` },
		});
		if (!res.ok) {
			console.error(`Failed to fetch models: ${res.status} ${res.statusText}`);
			return;
		}
		const body = (await res.json()) as { data?: any[] } | any[];
		const models: any[] = Array.isArray(body) ? body : body.data || [];

		modelRegistry.clear();

		for (const m of models) {
			// case.dev model IDs are like "anthropic/claude-sonnet-4.5"
			const id = m.id;
			const slashIndex = id.indexOf("/");
			const provider = slashIndex >= 0 ? id.slice(0, slashIndex) : "casedev";

			const model: Model<"openai-completions"> = {
				id,
				name: m.name || id,
				api: "openai-completions",
				provider: "casedev",
				baseUrl: llmBaseUrl,
				reasoning:
					m.reasoning ?? (id.includes("o1") || id.includes("o3") || id.includes("o4") || id.includes("opus")),
				input: m.input ?? ["text"],
				cost: m.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: m.context_window ?? m.contextWindow ?? 128000,
				maxTokens: m.max_tokens ?? m.maxTokens ?? 16384,
			};

			if (!modelRegistry.has(provider)) {
				modelRegistry.set(provider, new Map());
			}
			modelRegistry.get(provider)!.set(id, model);
		}

		modelsLoaded = true;
	} catch (error) {
		console.error("Failed to load models:", error);
	}
}

export function getModel(provider: string, modelId: string): Model<Api> | undefined {
	// Try exact match first
	const providerModels = modelRegistry.get(provider);
	if (providerModels?.has(modelId)) {
		return providerModels.get(modelId);
	}
	// Try searching all providers for the model ID
	for (const models of modelRegistry.values()) {
		if (models.has(modelId)) {
			return models.get(modelId);
		}
	}
	return undefined;
}

export function getModelOrThrow<TApi extends Api = Api>(provider: string, modelId: string): Model<TApi> {
	const model = getModel(provider, modelId);
	if (!model) {
		throw new Error(`Model not found: ${provider}/${modelId}`);
	}
	return model as Model<TApi>;
}

export function getProviders(): string[] {
	return Array.from(modelRegistry.keys());
}

export function getModels(provider?: string): Model<Api>[] {
	if (provider) {
		const models = modelRegistry.get(provider);
		return models ? Array.from(models.values()) : [];
	}
	// Return all models across all providers
	const all: Model<Api>[] = [];
	for (const models of modelRegistry.values()) {
		all.push(...models.values());
	}
	return all;
}

export function getAllModels(): Model<Api>[] {
	return getModels();
}

/**
 * Register models directly into the registry.
 * Useful in browser contexts where loadModels() can't access process.env.
 */
export function registerModels(models: Model<Api>[]): void {
	for (const model of models) {
		const slashIndex = model.id.indexOf("/");
		const providerKey = slashIndex >= 0 ? model.id.slice(0, slashIndex) : model.provider || "casedev";
		if (!modelRegistry.has(providerKey)) {
			modelRegistry.set(providerKey, new Map());
		}
		modelRegistry.get(providerKey)!.set(model.id, model);
	}
	modelsLoaded = true;
}

export function isModelsLoaded(): boolean {
	return modelsLoaded;
}

/**
 * Create a Model object for a configured model endpoint by ID.
 * Useful when you know the model ID but haven't fetched the registry yet.
 */
export function createCasedevModel(modelId: string): Model<"openai-completions"> {
	const llmBaseUrl = getEnvLlmBaseUrl();
	return {
		id: modelId,
		name: modelId,
		api: "openai-completions",
		provider: "casedev",
		baseUrl: llmBaseUrl,
		reasoning: modelId.includes("o1") || modelId.includes("o3") || modelId.includes("o4") || modelId.includes("opus"),
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	};
}

export function calculateCost<TApi extends Api>(model: Model<TApi>, usage: Usage): Usage["cost"] {
	usage.cost.input = (model.cost.input / 1000000) * usage.input;
	usage.cost.output = (model.cost.output / 1000000) * usage.output;
	usage.cost.cacheRead = (model.cost.cacheRead / 1000000) * usage.cacheRead;
	usage.cost.cacheWrite = (model.cost.cacheWrite / 1000000) * usage.cacheWrite;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
	return usage.cost;
}

/**
 * Check if a model supports xhigh thinking level.
 */
export function supportsXhigh<TApi extends Api>(model: Model<TApi>): boolean {
	if (model.id.includes("gpt-5.2") || model.id.includes("gpt-5.3") || model.id.includes("gpt-5.4")) {
		return true;
	}
	if (model.id.includes("opus-4-6") || model.id.includes("opus-4.6")) {
		return true;
	}
	return false;
}

/**
 * Check if two models are equal by comparing both their id and provider.
 */
export function modelsAreEqual<TApi extends Api>(
	a: Model<TApi> | null | undefined,
	b: Model<TApi> | null | undefined,
): boolean {
	if (!a || !b) return false;
	return a.id === b.id && a.provider === b.provider;
}
