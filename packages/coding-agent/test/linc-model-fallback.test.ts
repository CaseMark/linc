import type { Model } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI, ExtensionContext, ExtensionEvent, ExtensionHandler } from "../src/core/extensions/types.ts";
import modelFallbackExtension from "../src/linc/extensions/model-fallback.ts";
import {
	DEFAULT_FALLBACK_MODEL_ID,
	DEFAULT_FALLBACK_TTL_MS,
	DEFAULT_PRIMARY_MODEL_ID,
	getActiveModelFallback,
	getFallbackModelId,
	getFallbackTtlMs,
	isFallbackStatus,
	isPrimaryFallbackSource,
	LINC_MODEL_FALLBACK_ENTRY_TYPE,
	resolveFallbackModel,
} from "../src/linc/model-fallback.ts";

function fauxModel(id: string, provider = "casedev"): Model<string> {
	return {
		id,
		name: id,
		api: "openai-completions",
		provider,
		baseUrl: "https://api.case.dev/llm/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	};
}

describe("Linc model fallback helpers", () => {
	it("treats potassium aliases as the primary source", () => {
		expect(isPrimaryFallbackSource({ id: DEFAULT_PRIMARY_MODEL_ID })).toBe(true);
		expect(isPrimaryFallbackSource({ id: "core-potassium" })).toBe(false);
		expect(isPrimaryFallbackSource({ id: "casemark/core-lightning-pro" })).toBe(false);
	});

	it("retries only transient provider statuses", () => {
		expect(isFallbackStatus(529)).toBe(true);
		expect(isFallbackStatus(429)).toBe(true);
		expect(isFallbackStatus(502)).toBe(true);
		expect(isFallbackStatus(400)).toBe(false);
		expect(isFallbackStatus(401)).toBe(false);
	});

	it("reads ttl and fallback model from env with defaults", () => {
		expect(getFallbackTtlMs({})).toBe(DEFAULT_FALLBACK_TTL_MS);
		expect(getFallbackTtlMs({ LINC_MODEL_FALLBACK_TTL_MS: "120000" })).toBe(120000);
		expect(getFallbackTtlMs({ LINC_MODEL_FALLBACK_TTL_MS: "nope" })).toBe(DEFAULT_FALLBACK_TTL_MS);
		expect(getFallbackModelId({})).toBe(DEFAULT_FALLBACK_MODEL_ID);
		expect(getFallbackModelId({ LINC_MODEL_FALLBACK_MODEL: "casemark/core-lightning" })).toBe(
			"casemark/core-lightning",
		);
	});

	it("resolves the fallback model from the current provider first", () => {
		const potassium = fauxModel(DEFAULT_PRIMARY_MODEL_ID);
		const lightningPro = fauxModel(DEFAULT_FALLBACK_MODEL_ID);
		const registry = {
			find: (provider: string, modelId: string) => {
				if (provider === "casedev" && modelId === lightningPro.id) return lightningPro;
				if (provider === "casedev" && modelId === potassium.id) return potassium;
				return undefined;
			},
		};
		expect(resolveFallbackModel(registry, "casedev", DEFAULT_FALLBACK_MODEL_ID)).toEqual(lightningPro);
	});
});

describe("Linc model fallback extension", () => {
	const originalTtl = process.env.LINC_MODEL_FALLBACK_TTL_MS;
	const originalModel = process.env.LINC_MODEL_FALLBACK_MODEL;

	afterEach(() => {
		if (originalTtl === undefined) delete process.env.LINC_MODEL_FALLBACK_TTL_MS;
		else process.env.LINC_MODEL_FALLBACK_TTL_MS = originalTtl;
		if (originalModel === undefined) delete process.env.LINC_MODEL_FALLBACK_MODEL;
		else process.env.LINC_MODEL_FALLBACK_MODEL = originalModel;
	});

	function loadExtension(options?: {
		model?: Model<string>;
		models?: Model<string>[];
		nowEntries?: Array<{ customType: string; data?: unknown }>;
	}) {
		const potassium = fauxModel(DEFAULT_PRIMARY_MODEL_ID);
		const lightningPro = fauxModel(DEFAULT_FALLBACK_MODEL_ID);
		const models = options?.models ?? [potassium, lightningPro];
		const entries: Array<{ type: "custom"; customType: string; data?: unknown }> = (options?.nowEntries ?? []).map(
			(entry) => ({ type: "custom" as const, customType: entry.customType, data: entry.data }),
		);
		const notifications: Array<{ message: string; type: string | undefined }> = [];
		const statuses = new Map<string, string | undefined>();
		const selected: Model<string>[] = [];
		const handlers = new Map<string, ExtensionHandler<ExtensionEvent, unknown>[]>();
		let currentModel = options?.model ?? potassium;

		const ctx = {
			model: currentModel,
			sessionManager: {
				getEntries: () => entries,
			},
			modelRegistry: {
				find: (provider: string, modelId: string) =>
					models.find((model) => model.provider === provider && model.id === modelId),
			},
			ui: {
				notify: (message: string, type?: string) => notifications.push({ message, type }),
				setStatus: (key: string, value: string | undefined) => statuses.set(key, value),
			},
		} as unknown as ExtensionContext;

		const pi = {
			on: (event: string, handler: ExtensionHandler<ExtensionEvent, unknown>) => {
				handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			},
			appendEntry: (customType: string, data?: unknown) => {
				entries.push({ type: "custom", customType, data });
			},
			setModel: async (model: Model<string>) => {
				selected.push(model);
				currentModel = model;
				(ctx as { model: Model<string> }).model = model;
				return true;
			},
		} as unknown as ExtensionAPI;

		modelFallbackExtension(pi);

		const emit = async (event: ExtensionEvent) => {
			for (const handler of handlers.get(event.type) ?? []) {
				await handler(event, ctx);
			}
		};

		return { ctx, emit, entries, notifications, statuses, selected, potassium, lightningPro };
	}

	it("switches potassium to lightning-pro after a 529 and records a 10m restore window", async () => {
		const { emit, entries, selected, statuses, lightningPro } = loadExtension();

		await emit({ type: "after_provider_response", status: 529, headers: {} });

		expect(selected.map((model) => model.id)).toEqual([DEFAULT_FALLBACK_MODEL_ID]);
		expect(statuses.get("linc.model-fallback")).toBe(`fallback: ${DEFAULT_FALLBACK_MODEL_ID}`);
		const state = getActiveModelFallback({ getEntries: () => entries } as never);
		expect(state?.fallbackModelId).toBe(lightningPro.id);
		expect(state?.originalModelId).toBe(DEFAULT_PRIMARY_MODEL_ID);
		expect(state?.restoreAt).toBeGreaterThan(Date.now() + DEFAULT_FALLBACK_TTL_MS - 1000);
		expect(state?.restored).toBeFalsy();
	});

	it("does not switch on non-transient errors or non-potassium models", async () => {
		const { emit, selected } = loadExtension({ model: fauxModel(DEFAULT_FALLBACK_MODEL_ID) });
		await emit({ type: "after_provider_response", status: 529, headers: {} });
		expect(selected).toEqual([]);

		const again = loadExtension();
		await again.emit({ type: "after_provider_response", status: 400, headers: {} });
		expect(again.selected).toEqual([]);
	});

	it("restores the original model after the fallback window", async () => {
		const { emit, selected, potassium, lightningPro, statuses } = loadExtension({
			model: fauxModel(DEFAULT_FALLBACK_MODEL_ID),
			nowEntries: [
				{
					customType: LINC_MODEL_FALLBACK_ENTRY_TYPE,
					data: {
						originalProvider: "casedev",
						originalModelId: DEFAULT_PRIMARY_MODEL_ID,
						fallbackProvider: "casedev",
						fallbackModelId: DEFAULT_FALLBACK_MODEL_ID,
						restoreAt: Date.now() - 1,
					},
				},
			],
		});

		await emit({
			type: "before_agent_start",
			prompt: "hello",
			systemPrompt: "",
			systemPromptOptions: {} as never,
		});

		expect(selected.map((model) => model.id)).toEqual([potassium.id]);
		expect(statuses.get("linc.model-fallback")).toBeUndefined();
		void lightningPro;
	});
});
