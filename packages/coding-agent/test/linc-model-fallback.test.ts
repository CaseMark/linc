import type { Model } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI, ExtensionContext, ExtensionEvent, ExtensionHandler } from "../src/core/extensions/types.ts";
import modelFallbackExtension from "../src/linc/extensions/model-fallback.ts";
import {
	DEFAULT_FALLBACK_CHAIN,
	DEFAULT_FALLBACK_TTL_MS,
	getActiveModelFallback,
	getFallbackChain,
	getFallbackTtlMs,
	getNextFallbackModelId,
	isFallbackStatus,
	LINC_MODEL_FALLBACK_ENTRY_TYPE,
	resolveFallbackModel,
	STREAM_FAILURE_STATUS,
} from "../src/linc/model-fallback.ts";

const POTASSIUM = "casemark/core-potassium";
const LIGHTNING_PRO = "casemark/core-lightning-pro";
const SOL = "openai/gpt-5.6-sol";

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
	it("walks the chain in order and stops at the terminal model", () => {
		const chain = [...DEFAULT_FALLBACK_CHAIN];
		expect(getNextFallbackModelId(POTASSIUM, chain)).toBe(LIGHTNING_PRO);
		expect(getNextFallbackModelId(LIGHTNING_PRO, chain)).toBe(SOL);
		expect(getNextFallbackModelId(SOL, chain)).toBeUndefined();
	});

	it("routes core-family models outside the chain to the top of the chain", () => {
		const chain = [...DEFAULT_FALLBACK_CHAIN];
		expect(getNextFallbackModelId("casemark/core-lightning", chain)).toBe(POTASSIUM);
		expect(getNextFallbackModelId("casemark/core-mini", chain)).toBe(POTASSIUM);
		expect(getNextFallbackModelId("CASEMARK/CORE-POTASSIUM", chain)).toBe(LIGHTNING_PRO);
	});

	it("does not manage models outside the core family", () => {
		const chain = [...DEFAULT_FALLBACK_CHAIN];
		expect(getNextFallbackModelId("openai/gpt-5.6-terra", chain)).toBeUndefined();
		expect(getNextFallbackModelId("anthropic/claude-opus-5", chain)).toBeUndefined();
	});

	it("retries only transient provider statuses, including synthetic stream failures", () => {
		expect(isFallbackStatus(529)).toBe(true);
		expect(isFallbackStatus(429)).toBe(true);
		expect(isFallbackStatus(502)).toBe(true);
		expect(isFallbackStatus(STREAM_FAILURE_STATUS)).toBe(true);
		expect(isFallbackStatus(400)).toBe(false);
		expect(isFallbackStatus(401)).toBe(false);
	});

	it("reads ttl and chain from env with defaults", () => {
		expect(getFallbackTtlMs({})).toBe(DEFAULT_FALLBACK_TTL_MS);
		expect(getFallbackTtlMs({ LINC_MODEL_FALLBACK_TTL_MS: "120000" })).toBe(120000);
		expect(getFallbackTtlMs({ LINC_MODEL_FALLBACK_TTL_MS: "nope" })).toBe(DEFAULT_FALLBACK_TTL_MS);
		expect(getFallbackChain({})).toEqual([...DEFAULT_FALLBACK_CHAIN]);
		expect(getFallbackChain({ LINC_MODEL_FALLBACK_CHAIN: " a/b, c/d " })).toEqual(["a/b", "c/d"]);
		expect(getFallbackChain({ LINC_MODEL_FALLBACK_MODEL: "casemark/core-lightning" })).toEqual([
			"casemark/core-lightning",
			SOL,
		]);
		expect(getFallbackChain({ LINC_MODEL_FALLBACK_MODEL: SOL })).toEqual([SOL]);
	});

	it("resolves the fallback model from the current provider first", () => {
		const potassium = fauxModel(POTASSIUM);
		const lightningPro = fauxModel(LIGHTNING_PRO);
		const registry = {
			find: (provider: string, modelId: string) => {
				if (provider === "casedev" && modelId === lightningPro.id) return lightningPro;
				if (provider === "casedev" && modelId === potassium.id) return potassium;
				return undefined;
			},
		};
		expect(resolveFallbackModel(registry, "casedev", LIGHTNING_PRO)).toEqual(lightningPro);
	});
});

describe("Linc model fallback extension", () => {
	const originalTtl = process.env.LINC_MODEL_FALLBACK_TTL_MS;
	const originalModel = process.env.LINC_MODEL_FALLBACK_MODEL;
	const originalChain = process.env.LINC_MODEL_FALLBACK_CHAIN;

	afterEach(() => {
		if (originalTtl === undefined) delete process.env.LINC_MODEL_FALLBACK_TTL_MS;
		else process.env.LINC_MODEL_FALLBACK_TTL_MS = originalTtl;
		if (originalModel === undefined) delete process.env.LINC_MODEL_FALLBACK_MODEL;
		else process.env.LINC_MODEL_FALLBACK_MODEL = originalModel;
		if (originalChain === undefined) delete process.env.LINC_MODEL_FALLBACK_CHAIN;
		else process.env.LINC_MODEL_FALLBACK_CHAIN = originalChain;
	});

	function loadExtension(options?: {
		model?: Model<string>;
		models?: Model<string>[];
		nowEntries?: Array<{ customType: string; data?: unknown }>;
	}) {
		const potassium = fauxModel(POTASSIUM);
		const lightningPro = fauxModel(LIGHTNING_PRO);
		const sol = fauxModel(SOL);
		const models = options?.models ?? [potassium, lightningPro, sol];
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

		return { ctx, emit, entries, notifications, statuses, selected, potassium, lightningPro, sol };
	}

	it("switches potassium to lightning-pro after a 529 and records a 10m restore window", async () => {
		const { emit, entries, selected, statuses, notifications } = loadExtension();

		await emit({ type: "after_provider_response", status: 529, headers: {} });

		expect(selected.map((model) => model.id)).toEqual([LIGHTNING_PRO]);
		expect(statuses.get("linc.model-fallback")).toBe(`fallback: ${LIGHTNING_PRO}`);
		expect(notifications).toHaveLength(1);
		expect(notifications[0].type).toBe("warning");
		const state = getActiveModelFallback({ getEntries: () => entries } as never);
		expect(state?.fallbackModelId).toBe(LIGHTNING_PRO);
		expect(state?.originalModelId).toBe(POTASSIUM);
		expect(state?.restoreAt).toBeGreaterThan(Date.now() + DEFAULT_FALLBACK_TTL_MS - 1000);
		expect(state?.restored).toBeFalsy();
	});

	it("advances the chain to sol when the fallback model also fails, keeping the user's original", async () => {
		const { emit, entries, selected } = loadExtension();

		await emit({ type: "after_provider_response", status: 502, headers: {} });
		await emit({ type: "after_provider_response", status: 502, headers: {} });

		expect(selected.map((model) => model.id)).toEqual([LIGHTNING_PRO, SOL]);
		const state = getActiveModelFallback({ getEntries: () => entries } as never);
		expect(state?.fallbackModelId).toBe(SOL);
		expect(state?.originalModelId).toBe(POTASSIUM);
	});

	it("never switches away from the terminal model", async () => {
		const { emit, selected } = loadExtension({ model: fauxModel(SOL) });
		await emit({ type: "after_provider_response", status: 502, headers: {} });
		expect(selected).toEqual([]);
	});

	it("enters the chain at the top for core models outside it", async () => {
		const { emit, selected } = loadExtension({ model: fauxModel("casemark/core-lightning") });
		await emit({ type: "after_provider_response", status: 502, headers: {} });
		expect(selected.map((model) => model.id)).toEqual([POTASSIUM]);
	});

	it("deduplicates repeat failures from the same source while the fallback window is active", async () => {
		const { ctx, emit, entries, selected, notifications, potassium } = loadExtension();

		await emit({ type: "after_provider_response", status: 502, headers: {} });
		// A second in-flight request from the original model fails after the
		// switch (stale model context): same target, no second entry/notification.
		(ctx as { model: Model<string> }).model = potassium;
		await emit({ type: "after_provider_response", status: 502, headers: {} });

		const stateEntries = entries.filter((entry) => entry.customType === LINC_MODEL_FALLBACK_ENTRY_TYPE);
		expect(stateEntries).toHaveLength(1);
		expect(selected).toHaveLength(1);
		expect(notifications).toHaveLength(1);
	});

	it("does not switch on non-transient errors or unmanaged models", async () => {
		const { emit, selected } = loadExtension({ model: fauxModel("openai/gpt-5.6-terra") });
		await emit({ type: "after_provider_response", status: 529, headers: {} });
		expect(selected).toEqual([]);

		const again = loadExtension();
		await again.emit({ type: "after_provider_response", status: 400, headers: {} });
		expect(again.selected).toEqual([]);
	});

	it("restores the original model after the fallback window", async () => {
		const { emit, selected, potassium, statuses } = loadExtension({
			model: fauxModel(LIGHTNING_PRO),
			nowEntries: [
				{
					customType: LINC_MODEL_FALLBACK_ENTRY_TYPE,
					data: {
						originalProvider: "casedev",
						originalModelId: POTASSIUM,
						fallbackProvider: "casedev",
						fallbackModelId: LIGHTNING_PRO,
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
	});

	it("falls back again after a restore when the original is still failing", async () => {
		const { emit, entries, selected } = loadExtension({
			nowEntries: [
				{
					customType: LINC_MODEL_FALLBACK_ENTRY_TYPE,
					data: {
						originalProvider: "casedev",
						originalModelId: POTASSIUM,
						fallbackProvider: "casedev",
						fallbackModelId: LIGHTNING_PRO,
						restoreAt: Date.now() - 1,
						restored: true,
					},
				},
			],
		});

		await emit({ type: "after_provider_response", status: 502, headers: {} });

		expect(selected.map((model) => model.id)).toEqual([LIGHTNING_PRO]);
		const state = getActiveModelFallback({ getEntries: () => entries } as never);
		expect(state?.restored).toBeFalsy();
		expect(state?.originalModelId).toBe(POTASSIUM);
	});
});
