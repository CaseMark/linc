import { afterEach, describe, expect, test, vi } from "vitest";
import { perMillionTokens, roundCatalogCost, roundCatalogPrice } from "../scripts/catalog-price.ts";

describe("perMillionTokens", () => {
	test.each([
		// Values reported in the 0.79.21 catalog review
		["0.0000000177212", 0.0177212],
		["0.0000002156", 0.2156],
		["0.00000396", 3.96],
		// OpenRouter per-token strings observed in the live feed
		["0.000000020625", 0.020625],
		["0.00000012064", 0.12064],
		["0.0000006496", 0.6496],
		["0.000003", 3],
		["0.0000000001", 0.0001],
		["0", 0],
	])("converts %s per token to %s per million", (perToken, expected) => {
		expect(perMillionTokens(perToken)).toBe(expected);
	});

	test("accepts numeric per-token prices", () => {
		expect(perMillionTokens(0.00000012)).toBe(0.12);
	});

	describe("missing and unparseable prices", () => {
		afterEach(() => {
			vi.restoreAllMocks();
		});

		test("treats an absent price as free without warning", () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			expect(perMillionTokens(undefined)).toBe(0);
			expect(perMillionTokens("")).toBe(0);
			expect(warn).not.toHaveBeenCalled();
		});

		test("treats an unparseable price as free and warns", () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			expect(perMillionTokens("n/a")).toBe(0);
			expect(perMillionTokens(Number.NaN)).toBe(0);
			expect(warn).toHaveBeenCalledTimes(2);
			expect(warn.mock.calls[0][0]).toContain('"n/a"');
		});
	});

	test("rounds the OpenRouter Gemini repeating-decimal cache-write price", () => {
		expect(perMillionTokens("0.0000000416666666666667")).toBe(0.04166667);
	});
});

describe("roundCatalogPrice", () => {
	test.each([
		// Noise present in models.dev source values
		[0.049999999999999996, 0.05],
		[0.0024499999999999995, 0.00245],
		[0.09999999999999998, 0.1],
		[0.0833333333333333, 0.08333333],
		// Noise produced by per-token multiplication
		[0.7999999999999999, 0.8],
		[3.9600000000000004, 3.96],
		[0.017721200000000003, 0.0177212],
	])("normalizes %s to %s", (value, expected) => {
		expect(roundCatalogPrice(value)).toBe(expected);
	});

	test("leaves clean prices unchanged", () => {
		for (const value of [0, 0.5, 6.25, 15, 600, 0.020625, 0.0001]) {
			expect(roundCatalogPrice(value)).toBe(value);
		}
	});

	test("serializes with at most eight decimal places", () => {
		for (const value of [0.21559999999999999, 1 / 3, 2 / 7, 0.1 + 0.2, 123.456789012345]) {
			const text = String(roundCatalogPrice(value));
			expect(text).not.toMatch(/e/);
			expect((text.split(".")[1] ?? "").length).toBeLessThanOrEqual(8);
		}
	});

	test("is idempotent", () => {
		for (const value of [0.21559999999999999, 0.0416666666666667, 0.0177212, 5]) {
			const once = roundCatalogPrice(value);
			expect(roundCatalogPrice(once)).toBe(once);
		}
	});
});

describe("roundCatalogCost", () => {
	test("rounds every cost field and preserves other properties", () => {
		const cost = roundCatalogCost({
			input: 0.7999999999999999,
			output: 3.1999999999999997,
			cacheRead: 0.19999999999999998,
			cacheWrite: 0.0833333333333333,
			inputTiers: "kept",
		});
		expect(cost).toEqual({ input: 0.8, output: 3.2, cacheRead: 0.2, cacheWrite: 0.08333333, inputTiers: "kept" });
	});
});
