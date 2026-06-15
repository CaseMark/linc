import type { ResponseOutputMessage } from "openai/resources/responses/responses.js";
import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.ts";
import { convertResponsesMessages } from "../src/providers/openai-responses-shared.ts";
import type { AssistantMessage, Context, Usage } from "../src/types.ts";

const usage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

describe("OpenAI Responses message ID conversion", () => {
	it("generates unique fallback message IDs for multiple text blocks in one assistant turn", () => {
		const model = getModel("openai-codex", "gpt-5.5");
		const assistant: AssistantMessage = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "private reasoning" },
				{ type: "text", text: "visible answer" },
			],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-opus-4-8",
			usage,
			stopReason: "stop",
			timestamp: Date.now() - 1000,
		};
		const context: Context = {
			systemPrompt: "You are concise.",
			messages: [{ role: "user", content: "hello", timestamp: Date.now() - 2000 }, assistant],
		};

		const input = convertResponsesMessages(model, context, new Set(["openai", "openai-codex", "opencode"]));
		const messageIds = input
			.filter(
				(item): item is ResponseOutputMessage =>
					item.type === "message" && "id" in item && typeof item.id === "string",
			)
			.map((item) => item.id);

		expect(messageIds).toEqual(["msg_pi_1", "msg_pi_1_1"]);
		expect(new Set(messageIds).size).toBe(messageIds.length);
	});

	it("can omit replayed reasoning items for store:false requests", () => {
		const model = getModel("openai", "gpt-5-mini");
		const assistant: AssistantMessage = {
			role: "assistant",
			content: [
				{
					type: "thinking",
					thinking: "",
					thinkingSignature: JSON.stringify({ id: "rs_previous", type: "reasoning", content: [], summary: [] }),
				},
				{
					type: "toolCall",
					id: "call_previous|fc_previous",
					name: "calculate",
					arguments: { expression: "2 + 2" },
				},
			],
			api: "openai-responses",
			provider: "openai",
			model: "gpt-5-mini",
			usage,
			stopReason: "toolUse",
			timestamp: Date.now() - 1000,
		};
		const context: Context = {
			systemPrompt: "You are concise.",
			messages: [{ role: "user", content: "Use the tool.", timestamp: Date.now() - 2000 }, assistant],
		};

		const input = convertResponsesMessages(model, context, new Set(["openai", "openai-codex", "opencode"]), {
			includeReasoningItems: false,
		});

		expect(input.some((item) => item.type === "reasoning")).toBe(false);
		expect(input.some((item) => item.type === "function_call")).toBe(true);
		expect(input.some((item) => item.type === "function_call_output")).toBe(true);
	});
});
