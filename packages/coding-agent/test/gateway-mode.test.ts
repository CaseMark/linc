import type { AgentMessage } from "@casemark/linc-agent-core";
import type { AssistantMessage } from "@casemark/linc-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, AgentSessionEvent } from "../src/core/agent-session.js";
import { type GatewayHandle, startGateway } from "../src/modes/gateway/gateway-mode.js";

type FakeSession = {
	session: AgentSession;
	prompts: string[];
	histories: AgentMessage[][];
	dispose: ReturnType<typeof vi.fn>;
};

function createAssistantMessage(text: string, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return {
		role: "assistant",
		content: text ? [{ type: "text", text }] : [],
		api: "openai-completions",
		provider: "casedev",
		model: "anthropic/claude-sonnet-4.5",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

function createFakeSession(answerParts: string[] = ["hello"]): FakeSession {
	const prompts: string[] = [];
	const histories: AgentMessage[][] = [];
	const messages: AgentMessage[] = [];
	const listeners = new Set<(event: AgentSessionEvent) => void>();
	const dispose = vi.fn();
	const agent = {
		replaceMessages: vi.fn((history: AgentMessage[]) => {
			histories.push(history);
			messages.splice(0, messages.length, ...history);
		}),
		waitForIdle: vi.fn(async () => {}),
	};
	const session = {
		agent,
		get messages() {
			return messages;
		},
		subscribe: (listener: (event: AgentSessionEvent) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		prompt: async (text: string) => {
			prompts.push(text);
			for (const delta of answerParts) {
				const event = {
					type: "message_update",
					assistantMessageEvent: { type: "text_delta", delta },
				} as AgentSessionEvent;
				for (const listener of listeners) {
					listener(event);
				}
			}
			messages.push(createAssistantMessage(answerParts.join("")));
		},
		dispose,
	} as unknown as AgentSession;

	return { session, prompts, histories, dispose };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
	return (await response.json()) as Record<string, unknown>;
}

describe("gateway mode", () => {
	let gateway: GatewayHandle | undefined;

	afterEach(async () => {
		if (gateway) {
			await gateway.close();
			gateway = undefined;
		}
	});

	it("serves health and OpenAI-compatible models", async () => {
		gateway = await startGateway({
			port: 0,
			listModels: async () => [{ id: "linc/casedev/anthropic/claude-sonnet-4.5" }, { id: "linc/default" }],
		});

		const health = await fetch(`${gateway.url}/health`);
		expect(health.status).toBe(200);
		expect(await readJson(health)).toEqual({ status: "ok" });

		const models = await fetch(`${gateway.url}/v1/models`);
		expect(models.status).toBe(200);
		expect(await readJson(models)).toMatchObject({
			object: "list",
			data: [
				{ id: "linc/casedev/anthropic/claude-sonnet-4.5", object: "model", owned_by: "linc" },
				{ id: "linc/default", object: "model", owned_by: "linc" },
			],
		});
	});

	it("maps OpenAI chat messages into a Linc session and returns a completion", async () => {
		const fake = createFakeSession(["case", ".dev"]);
		gateway = await startGateway({
			port: 0,
			createSession: async () => fake.session,
		});

		const response = await fetch(`${gateway.url}/v1/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: "linc/default",
				messages: [
					{ role: "system", content: "Follow legal style." },
					{ role: "user", content: "Earlier user" },
					{ role: "assistant", content: "Earlier assistant" },
					{ role: "user", content: [{ type: "text", text: "Now answer" }] },
				],
			}),
		});

		expect(response.status).toBe(200);
		const body = await readJson(response);
		expect(body).toMatchObject({
			object: "chat.completion",
			model: "linc/default",
			choices: [{ message: { role: "assistant", content: "case.dev" }, finish_reason: "stop" }],
		});
		expect(fake.prompts).toEqual(["Client system instructions:\nFollow legal style.\n\nUser request:\nNow answer"]);
		expect(fake.histories[0].map((message) => message.role)).toEqual(["user", "assistant"]);
		expect(fake.dispose).toHaveBeenCalledTimes(1);
	});

	it("streams OpenAI SSE chat chunks", async () => {
		const fake = createFakeSession(["hel", "lo"]);
		gateway = await startGateway({
			port: 0,
			createSession: async () => fake.session,
		});

		const response = await fetch(`${gateway.url}/v1/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: "linc/default",
				stream: true,
				messages: [{ role: "user", content: "Say hello" }],
			}),
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		const text = await response.text();
		expect(text).toContain('"role":"assistant"');
		expect(text).toContain('"content":"hel"');
		expect(text).toContain('"content":"lo"');
		expect(text).toContain('"finish_reason":"stop"');
		expect(text.trim().endsWith("data: [DONE]")).toBe(true);
		expect(fake.dispose).toHaveBeenCalledTimes(1);
	});

	it("rejects unsupported request shapes", async () => {
		const fake = createFakeSession();
		gateway = await startGateway({
			port: 0,
			createSession: async () => fake.session,
		});

		const response = await fetch(`${gateway.url}/v1/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: "linc/default",
				messages: [{ role: "tool", content: "nope" }],
			}),
		});

		expect(response.status).toBe(400);
		expect((await readJson(response)).error).toMatchObject({
			message: 'Unsupported message role "tool".',
		});
		expect(fake.prompts).toEqual([]);
	});

	it("requires bearer auth when configured", async () => {
		const fake = createFakeSession();
		gateway = await startGateway({
			port: 0,
			apiKey: "secret",
			createSession: async () => fake.session,
		});

		const unauthorized = await fetch(`${gateway.url}/v1/models`);
		expect(unauthorized.status).toBe(401);

		const authorized = await fetch(`${gateway.url}/v1/models`, {
			headers: { authorization: "Bearer secret" },
		});
		expect(authorized.status).toBe(200);
	});

	it("returns 400 for invalid JSON and 404 for unknown routes", async () => {
		gateway = await startGateway({ port: 0 });

		const invalidJson = await fetch(`${gateway.url}/v1/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{",
		});
		expect(invalidJson.status).toBe(400);

		const missing = await fetch(`${gateway.url}/v1/unknown`);
		expect(missing.status).toBe(404);
	});
});
