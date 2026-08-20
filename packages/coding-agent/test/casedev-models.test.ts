import { describe, expect, it } from "vitest";
import { CASEDEV_PROVIDER_ID } from "../src/linc/casedev-auth.ts";
import { parseCaseDevModelsResponse } from "../src/linc/casedev-models.ts";

const catalog = {
	data: [
		{
			id: "casemark/core-mini",
			name: "CaseMark Core Mini",
			type: "language",
			tags: ["reasoning"],
			pricing: { input: "0.000002", output: "0.000006", input_cache_read: "0.0000001" },
			context_window: 262144,
			max_tokens: 32000,
		},
		{
			id: "openai/gpt-5.6-sol",
			name: "GPT-5.6 Sol",
			type: "language",
			tags: ["reasoning", "multimodal"],
			pricing: { input: "0.00000125", output: "0.00001" },
			context_window: 400000,
			max_tokens: 128000,
		},
		{ id: "an-embedding", type: "embedding" },
		{
			id: "broken-window",
			type: "language",
			pricing: { input: "0.000001", output: "0.000002" },
			context_window: 0,
			max_tokens: 8000,
		},
	],
};

describe("parseCaseDevModelsResponse", () => {
	it("maps cache-read pricing $/token -> $/mtok and defaults absent to 0", () => {
		const models = parseCaseDevModelsResponse(catalog);
		const mini = models.find((model) => model.id === "casemark/core-mini");
		expect(mini?.cost.input).toBe(2);
		expect(mini?.cost.output).toBe(6);
		expect(mini?.cost.cacheRead).toBeCloseTo(0.1, 10);
		expect(mini?.cost.cacheWrite).toBe(0);
		const sol = models.find((model) => model.id === "openai/gpt-5.6-sol");
		expect(sol?.cost.cacheRead).toBe(0);
	});

	it("rejects non-positive published context windows, keeps absent-as-default", () => {
		const models = parseCaseDevModelsResponse(catalog);
		expect(models.some((model) => model.id === "broken-window")).toBe(false);
		expect(models.find((model) => model.id === "casemark/core-mini")?.contextWindow).toBe(262144);
	});

	it("applies compat overrides to every parsed model", () => {
		const models = parseCaseDevModelsResponse(catalog, CASEDEV_PROVIDER_ID, {
			compat: { supportsDeveloperRole: false },
		});
		expect(models.length).toBeGreaterThan(0);
		for (const model of models) {
			expect(model.compat).toEqual({ supportsDeveloperRole: false });
		}
	});

	it("filters non-language entries and keeps multimodal input mapping", () => {
		const models = parseCaseDevModelsResponse(catalog);
		expect(models.some((model) => model.id === "an-embedding")).toBe(false);
		expect(models.find((model) => model.id === "openai/gpt-5.6-sol")?.input).toEqual(["text", "image"]);
	});
});
