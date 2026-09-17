import { afterEach, describe, expect, test, vi } from "vitest";
import { effectiveContextWindow, fetchCaseDevModels, parseCaseDevModelsResponse } from "../src/linc/casedev-models.ts";

function record(overrides: Record<string, unknown>) {
	return {
		id: "vendor/model",
		object: "model",
		type: "language",
		name: "Model",
		context_window: 262144,
		max_tokens: 32000,
		tags: [],
		pricing: { input: "0.000002", output: "0.000006" },
		...overrides,
	};
}

function parseOne(overrides: Record<string, unknown>) {
	return parseCaseDevModelsResponse({ object: "list", data: [record(overrides)] })[0];
}

describe("casedev catalog parsing", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	test("core-mini keeps the window and output cap the sandbox has always run with", () => {
		// Subagent children run core-mini (sglang --context-length 262144). The
		// router used to inject 262144 by env; the catalog now says the same.
		const model = parseOne({
			id: "casemark/core-mini",
			context_window: 262144,
			max_tokens: 32000,
			tags: ["reasoning", "legal", "fast", "efficient"],
			pricing: { input: "0.000002", output: "0.000006", input_cache_read: "0.0000001" },
		});
		expect(model).toMatchObject({
			contextWindow: 262144,
			maxTokens: 32000,
			reasoning: true,
			input: ["text"],
			cost: { input: 2, output: 6, cacheRead: expect.closeTo(0.1, 6), cacheWrite: 0 },
			compat: { supportsDeveloperRole: false },
		});
	});

	test("a two-tier long-context price cliff caps the planning window", () => {
		const model = parseOne({
			id: "openai/gpt-5.6-sol",
			context_window: 1050000,
			max_tokens: 128000,
			tags: ["reasoning"],
			modalities: { input: ["text", "image", "pdf"], output: ["text"] },
			pricing: {
				input: "0.000002",
				input_tiers: [
					{ cost: "0.000002", min: 0, max: 272000 },
					{ cost: "0.000004", min: 272000 },
				],
				output: "0.00001",
			},
		});
		expect(model).toMatchObject({ contextWindow: 272000, maxTokens: 128000, input: ["text", "image"] });
	});

	test("a flat two-tier ladder is not a cliff", () => {
		expect(
			effectiveContextWindow(1000000, {
				input_tiers: [
					{ cost: "0.0000005", min: 0, max: 200001 },
					{ cost: "0.0000005", min: 200001 },
				],
			}),
		).toBe(1000000);
	});

	test("a graded ladder with more than two tiers is ignored", () => {
		expect(
			effectiveContextWindow(262144, {
				input_tiers: [
					{ cost: "0.0000015", min: 0, max: 32001 },
					{ cost: "0.0000027", min: 32001, max: 128001 },
					{ cost: "0.0000045", min: 128001 },
				],
			}),
		).toBe(262144);
	});

	test("a boundary at or beyond the window changes nothing", () => {
		expect(
			effectiveContextWindow(200000, {
				input_tiers: [
					{ cost: "1", min: 0, max: 200000 },
					{ cost: "2", min: 200000 },
				],
			}),
		).toBe(200000);
		expect(effectiveContextWindow(200000, {})).toBe(200000);
	});

	test("image support is read from modalities.input only; tags never grant it (CD-1621)", () => {
		expect(parseOne({ tags: ["vision"], modalities: { input: ["text"] } })?.input).toEqual(["text"]);
		expect(parseOne({ tags: [], modalities: { input: ["text", "image", "pdf"] } })?.input).toEqual(["text", "image"]);
		expect(parseOne({ tags: ["multimodal"] })?.input).toEqual(["text"]);
		expect(parseOne({ tags: ["vision"] })?.input).toEqual(["text"]);
		expect(parseOne({ modalities: null })?.input).toEqual(["text"]);
	});

	test("records without a usable window or output cap are dropped, not defaulted", () => {
		expect(parseOne({ context_window: undefined })).toBeUndefined();
		expect(parseOne({ context_window: 0 })).toBeUndefined();
		expect(parseOne({ max_tokens: 0 })).toBeUndefined();
		expect(parseOne({ type: "embedding", context_window: 10240, max_tokens: 0 })).toBeUndefined();
		expect(parseOne({ context_window: "131072", max_tokens: "8192" })).toMatchObject({
			contextWindow: 131072,
			maxTokens: 8192,
		});
	});

	test("fetch sends the Vercel protection bypass when the sandbox env carries it", async () => {
		vi.stubEnv("CASEDEV_VERCEL_PROTECTION_BYPASS", "bypass-secret");
		vi.stubEnv("CASE_API_URL", "https://preview.api.case.dev");
		const fetchFn = vi.fn(async () => ({
			ok: true,
			json: async () => ({ object: "list", data: [record({})] }),
		}));

		const models = await fetchCaseDevModels(fetchFn as unknown as typeof fetch);

		expect(models).toHaveLength(1);
		expect(fetchFn).toHaveBeenCalledWith(
			"https://preview.api.case.dev/llm/v1/models",
			expect.objectContaining({ headers: { "x-vercel-protection-bypass": "bypass-secret" } }),
		);
	});
});
