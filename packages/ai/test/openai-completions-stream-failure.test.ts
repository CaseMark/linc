import { describe, expect, it, vi } from "vitest";
import { streamOpenAICompletions } from "../src/providers/openai-completions.ts";
import type { Context, Model, ProviderResponse } from "../src/types.ts";

// Upstream dies mid-stream with no HTTP status (connection terminated, stream
// truncation). onResponse must still fire, with the synthetic 599 status, so
// the Linc model-fallback extension can react to this class of outage.
vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: () => {
					const promise = new Promise(() => {}) as Promise<never> & {
						withResponse: () => Promise<never>;
					};
					promise.withResponse = () => Promise.reject(new Error("terminated"));
					return promise;
				},
			},
		};
	}
	return { default: FakeOpenAI };
});

const model: Model<"openai-completions"> = {
	id: "casemark/core-potassium",
	name: "Core Potassium",
	api: "openai-completions",
	provider: "casedev",
	baseUrl: "https://api.case.dev/llm/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 100,
};

const context: Context = {
	systemPrompt: "",
	messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 }],
	tools: [],
};

describe("openai-completions onResponse for status-less stream failures", () => {
	it("invokes onResponse with a synthetic 599 when the stream dies without an HTTP status", async () => {
		const seen: ProviderResponse[] = [];
		const stream = streamOpenAICompletions(model, context, {
			apiKey: "test",
			onResponse: (response) => {
				seen.push(response);
			},
		});
		for await (const _event of stream) {
			void _event;
		}
		const result = await stream.result();

		expect(result.stopReason).toBe("error");
		expect(seen).toEqual([{ status: 599, headers: {} }]);
	});

	it("does not invoke onResponse when the request was aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const seen: ProviderResponse[] = [];
		const stream = streamOpenAICompletions(model, context, {
			apiKey: "test",
			signal: controller.signal,
			onResponse: (response) => {
				seen.push(response);
			},
		});
		for await (const _event of stream) {
			void _event;
		}
		await stream.result();

		expect(seen).toEqual([]);
	});
});
