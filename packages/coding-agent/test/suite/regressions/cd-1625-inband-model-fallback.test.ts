import type { FauxResponseFactory } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { streamOpenAICompletions } from "../../../../ai/src/providers/openai-completions.ts";
import modelFallbackExtension from "../../../src/linc/extensions/model-fallback.ts";
import { DEFAULT_FALLBACK_CHAIN, getActiveModelFallback } from "../../../src/linc/model-fallback.ts";
import { createHarness, getAssistantTexts, getUserTexts, type Harness } from "../harness.ts";

let harness: Harness | undefined;
afterEach(() => {
	harness?.cleanup();
	harness = undefined;
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("CD-1625: in-stream provider errors activate model fallback", () => {
	it.each([{ code: 400 }, { status: 401 }, { type: "permission_error" }, { code: "insufficient_quota" }])(
		"does not switch models for a non-transient SSE error %j",
		async (detail) => {
			harness = await createHarness({
				models: DEFAULT_FALLBACK_CHAIN.map((id) => ({ id })),
				extensionFactories: [modelFallbackExtension],
				settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
			});
			const fetch = vi
				.fn()
				.mockImplementation(
					async () =>
						new Response(`data: ${JSON.stringify({ error: { message: "Request rejected", ...detail } })}\n\n`, {
							status: 200,
							headers: { "content-type": "text/event-stream" },
						}),
				);
			vi.stubGlobal("fetch", fetch);
			harness.setResponses([
				(context, options, _state, model) =>
					streamOpenAICompletions({ ...model, api: "openai-completions" }, context, options).result(),
			]);
			await harness.session.prompt("Continue the research");
			expect(fetch).toHaveBeenCalledTimes(1);
			expect(harness.session.model?.id).toBe(DEFAULT_FALLBACK_CHAIN[0]);
			expect(getActiveModelFallback(harness.sessionManager)).toBeUndefined();
			expect(harness.eventsOfType("auto_retry_start")).toHaveLength(0);
		},
	);

	it.each([1, 2, 4])("recovers or exhausts the existing retry budget after %i failures", async (failures) => {
		vi.stubEnv("LINC_MODEL_FALLBACK_CHAIN", DEFAULT_FALLBACK_CHAIN.join(","));
		harness = await createHarness({
			models: DEFAULT_FALLBACK_CHAIN.map((id) => ({ id })),
			extensionFactories: [modelFallbackExtension],
			settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
		});
		const requests: Array<{ model: string; messages: Array<{ role: string }> }> = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: unknown, init?: RequestInit) => {
				requests.push(JSON.parse(String(init?.body)));
				const data =
					requests.length <= failures
						? {
								error: {
									message:
										"HttpError: HTTP 500: Internal server error BackendUnknown: RuntimeError: Failed to generate",
								},
							}
						: { choices: [{ index: 0, delta: { content: "Recovered answer" }, finish_reason: "stop" }] };
				return new Response(`data: ${JSON.stringify(data)}\n\ndata: [DONE]\n\n`, {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				});
			}),
		);
		// Keep the suite's faux provider/session harness, but exercise the real
		// SDK stream parser and provider hook with synthetic HTTP responses.
		const step: FauxResponseFactory = (context, options, _state, model) =>
			streamOpenAICompletions({ ...model, api: "openai-completions" }, context, options).result();
		harness.setResponses(Array.from({ length: 4 }, () => step));
		await harness.session.prompt("Continue the research");

		const expectedModels = [...DEFAULT_FALLBACK_CHAIN, DEFAULT_FALLBACK_CHAIN[2]].slice(0, Math.min(failures + 1, 4));
		expect(requests.map((request) => request.model)).toEqual(expectedModels);
		expect(getUserTexts(harness)).toEqual(["Continue the research"]);
		expect(
			requests.every((request) => request.messages.filter((message) => message.role === "user").length === 1),
		).toBe(true);
		expect(getActiveModelFallback(harness.sessionManager)?.originalModelId).toBe(DEFAULT_FALLBACK_CHAIN[0]);
		expect(harness.eventsOfType("auto_retry_start")).toHaveLength(Math.min(failures, 3));
		expect(harness.eventsOfType("auto_retry_end").at(-1)?.success).toBe(failures < 4);
		if (failures < 4) expect(getAssistantTexts(harness).at(-1)).toBe("Recovered answer");
	});
});
