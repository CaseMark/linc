import { beforeEach, describe, expect, it, vi } from "vitest";
import { convertMessages } from "../src/providers/openai-completions.ts";
import { complete } from "../src/stream.ts";
import type { AssistantMessage, Context, Model, Usage } from "../src/types.ts";

// Anthropic (via an OpenAI-compatible gateway) returns its thinking as a signed
// `reasoning_details` entry with empty text; OpenAI returns a summary plus an
// encrypted entry. The model only keeps its prior reasoning on the next request
// if those entries are sent back unchanged.

const mockState = vi.hoisted(() => ({ chunks: [] as unknown[] }));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: () => {
					const chunks = mockState.chunks;
					const stream = {
						async *[Symbol.asyncIterator]() {
							for (const chunk of chunks) yield chunk;
						},
					};
					const promise = Promise.resolve(stream) as Promise<typeof stream> & {
						withResponse: () => Promise<{ data: typeof stream; response: { status: number; headers: Headers } }>;
					};
					promise.withResponse = async () => ({ data: stream, response: { status: 200, headers: new Headers() } });
					return promise;
				},
			},
		};
	}
	return { default: FakeOpenAI };
});

const emptyUsage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function sonnet(): Model<"openai-completions"> {
	return {
		id: "anthropic/claude-sonnet-5.5",
		name: "Claude Sonnet 5.5",
		api: "openai-completions",
		provider: "casedev",
		baseUrl: "https://example.invalid/llm/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 272_000,
		maxTokens: 8192,
	};
}

function chunk(delta: Record<string, unknown>, extra: Record<string, unknown> = {}) {
	return { id: "c1", model: "anthropic/claude-sonnet-5.5", choices: [{ index: 0, delta, ...extra }] };
}

function assistantWith(
	details: Record<string, unknown>[] | undefined,
	model = "anthropic/claude-sonnet-5.5",
): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id: "call_1", name: "lookup", arguments: { q: "x" } }],
		api: "openai-completions",
		provider: "casedev",
		model,
		usage: emptyUsage,
		stopReason: "toolUse",
		timestamp: 2,
		...(details ? { reasoningDetails: details } : {}),
	};
}

function contextWith(assistant: AssistantMessage): Context {
	return {
		messages: [
			{ role: "user", content: "go", timestamp: 1 },
			assistant,
			{
				role: "toolResult",
				toolCallId: "call_1",
				toolName: "lookup",
				content: [{ type: "text", text: "ok" }],
				isError: false,
				timestamp: 3,
			},
		],
	};
}

const SIGNED = { type: "reasoning.text", text: "", signature: "sig-abc", format: "anthropic-claude-v1", index: 0 };

describe("openai-completions reasoning_details", () => {
	beforeEach(() => {
		mockState.chunks = [];
	});

	it("keeps every streamed entry, merging fragments by type and index", async () => {
		mockState.chunks = [
			chunk({
				reasoning_details: [
					{ type: "reasoning.summary", summary: "Checking ", format: "openai-responses-v1", index: 0 },
				],
			}),
			chunk({ reasoning_details: [{ type: "reasoning.summary", summary: "dates.", index: 0 }] }),
			chunk({
				reasoning_details: [
					{ type: "reasoning.encrypted", data: "enc-1", id: "rs_1", format: "openai-responses-v1", index: 0 },
				],
			}),
			chunk({ reasoning_details: [{ type: "reasoning.text", text: "", format: "anthropic-claude-v1", index: 1 }] }),
			chunk({ reasoning_details: [{ type: "reasoning.text", signature: "sig-abc", index: 1 }] }),
			chunk({ content: "done" }),
			chunk({}, { finish_reason: "stop" }),
		];

		const message = await complete(
			sonnet(),
			{ messages: [{ role: "user", content: "hi", timestamp: 1 }] },
			{ apiKey: "test" },
		);

		expect(message.reasoningDetails).toEqual([
			{ type: "reasoning.summary", summary: "Checking dates.", format: "openai-responses-v1", index: 0 },
			{ type: "reasoning.encrypted", data: "enc-1", id: "rs_1", format: "openai-responses-v1", index: 0 },
			{ type: "reasoning.text", text: "", signature: "sig-abc", format: "anthropic-claude-v1", index: 1 },
		]);
	});

	it("sends the captured entries back unchanged on the next request", () => {
		const messages = convertMessages(sonnet(), contextWith(assistantWith([SIGNED])), {} as never);
		const assistant = messages.find((m) => m.role === "assistant") as unknown as Record<string, unknown>;
		expect(assistant.reasoning_details).toEqual([SIGNED]);
	});

	it("drops them when the next request goes to a different model", () => {
		const messages = convertMessages(sonnet(), contextWith(assistantWith([SIGNED], "openai/gpt-6-sol")), {} as never);
		const assistant = messages.find((m) => m.role === "assistant") as unknown as Record<string, unknown>;
		expect(assistant.reasoning_details).toBeUndefined();
	});
});
