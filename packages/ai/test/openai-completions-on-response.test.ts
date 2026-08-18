import { describe, expect, it, vi } from "vitest";
import { streamOpenAICompletions } from "../src/providers/openai-completions.ts";
import type { Context, Model, ProviderResponse } from "../src/types.ts";

vi.mock("openai", () => {
	class FakeAPIError extends Error {
		status = 529;
		headers = new Headers({ "retry-after": "2" });
		constructor() {
			super("529 Overloaded");
		}
	}
	class FakeOpenAI {
		chat = {
			completions: {
				create: () => {
					const promise = new Promise(() => {}) as Promise<never> & {
						withResponse: () => Promise<never>;
					};
					promise.withResponse = () => Promise.reject(new FakeAPIError());
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

describe("openai-completions onResponse for failed HTTP statuses", () => {
	it("invokes onResponse with the 529 status when create().withResponse() rejects", async () => {
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
		expect(seen).toEqual([{ status: 529, headers: { "retry-after": "2" } }]);
	});
});
