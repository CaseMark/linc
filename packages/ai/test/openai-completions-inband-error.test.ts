import { afterEach, describe, expect, it, vi } from "vitest";
import { streamOpenAICompletions } from "../src/providers/openai-completions.ts";
import type { Context, Model, ProviderResponse } from "../src/types.ts";

const model: Model<"openai-completions"> = {
	id: "casemark/core-potassium",
	name: "Potassium",
	api: "openai-completions",
	provider: "casedev",
	baseUrl: "https://provider.invalid/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 1024,
};
const context: Context = { messages: [{ role: "user", content: "Hello", timestamp: 0 }] };
const generationError = "HttpError: HTTP 500: Internal server error BackendUnknown: RuntimeError: Failed to generate";

function mockStream(frames: unknown[]) {
	const fetch = vi.fn().mockResolvedValue(
		new Response(`${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")}data: [DONE]\n\n`, {
			status: 200,
			headers: { "content-type": "text/event-stream", "x-request-id": "test-request" },
		}),
	);
	vi.stubGlobal("fetch", fetch);
	return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenAI SDK errors inside HTTP 200 streams", () => {
	it.each([false, true])("reports the production error after partial output=%s", async (partial) => {
		mockStream([
			...(partial ? [{ choices: [{ index: 0, delta: { content: "Partial" }, finish_reason: null }] }] : []),
			{ error: { message: generationError } },
		]);
		const responses: ProviderResponse[] = [];
		const result = await streamOpenAICompletions(model, context, {
			apiKey: "test",
			onResponse: (response) => {
				responses.push(response);
			},
		}).result();
		expect(responses.map((response) => response.status)).toEqual([200, 599]);
		expect(responses[1].headers["x-request-id"]).toBe("test-request");
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toBe(generationError);
		if (partial) expect(result.content).toContainEqual({ type: "text", text: "Partial" });
	});

	it.each([
		[{ status: 503 }, 503],
		[{ status_code: 429 }, 429],
		[{ code: "500" }, 500],
		[{ code: 400 }, 400],
		[{ status: 401 }, 401],
		[{ type: "invalid_request_error" }, 400],
		[{ type: "authentication_error" }, 401],
		[{ code: "insufficient_quota", type: "server_error" }, 402],
		[{ type: "permission_error" }, 403],
		[{ code: "content_filter" }, 400],
	] as const)("preserves structured failure classification %j", async (fields, status) => {
		mockStream([{ error: { message: "Provider rejected request", ...fields } }]);
		const statuses: number[] = [];
		await streamOpenAICompletions(model, context, {
			apiKey: "test",
			onResponse: (response) => {
				statuses.push(response.status);
			},
		}).result();
		expect(statuses).toEqual([200, status]);
	});

	it("does not report a provider failure after user cancellation", async () => {
		mockStream([{ error: { message: generationError } }]);
		const controller = new AbortController();
		const statuses: number[] = [];
		const result = await streamOpenAICompletions(model, context, {
			apiKey: "test",
			signal: controller.signal,
			onResponse: (response) => {
				statuses.push(response.status);
				controller.abort();
			},
		}).result();
		expect(statuses).toEqual([200]);
		expect(result.stopReason).toBe("aborted");
	});

	it("does not mistake a local callback error for an upstream outage", async () => {
		const fetch = mockStream([]);
		const statuses: number[] = [];
		const result = await streamOpenAICompletions(model, context, {
			apiKey: "test",
			onPayload: () => {
				throw new TypeError(generationError);
			},
			onResponse: (response) => {
				statuses.push(response.status);
			},
		}).result();
		expect(result.stopReason).toBe("error");
		expect(statuses).toEqual([]);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("still reports a stream with no finish reason as 599", async () => {
		mockStream([{ choices: [{ index: 0, delta: { content: "Partial" }, finish_reason: null }] }]);
		const statuses: number[] = [];
		const result = await streamOpenAICompletions(model, context, {
			apiKey: "test",
			onResponse: (response) => {
				statuses.push(response.status);
			},
		}).result();
		expect(statuses).toEqual([200, 599]);
		expect(result.errorMessage).toBe("Stream ended without finish_reason");
	});

	it("leaves successful streams unchanged", async () => {
		mockStream([{ choices: [{ index: 0, delta: { content: "Done" }, finish_reason: "stop" }] }]);
		const statuses: number[] = [];
		const result = await streamOpenAICompletions(model, context, {
			apiKey: "test",
			onResponse: (response) => {
				statuses.push(response.status);
			},
		}).result();
		expect(statuses).toEqual([200]);
		expect(result.stopReason).toBe("stop");
		expect(result.content).toEqual([{ type: "text", text: "Done" }]);
	});
});
