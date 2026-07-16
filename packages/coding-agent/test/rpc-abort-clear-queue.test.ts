import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { type AssistantMessage, type AssistantMessageEvent, EventStream, getModel } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { runRpcMode } from "../src/modes/rpc/rpc-mode.ts";
import { createTestResourceLoader } from "./utilities.ts";

const rpcIo = vi.hoisted(() => ({
	outputLines: [] as string[],
	lineHandler: undefined as ((line: string) => void) | undefined,
}));

vi.mock("../src/core/output-guard.js", () => ({
	flushRawStdout: vi.fn(async () => {}),
	takeOverStdout: vi.fn(),
	waitForRawStdoutBackpressure: vi.fn(async () => {}),
	writeRawStdout: (line: string) => {
		rpcIo.outputLines.push(line);
	},
}));

vi.mock("../src/modes/interactive/theme/theme.js", () => ({ theme: {} }));

vi.mock("../src/modes/rpc/jsonl.js", () => ({
	attachJsonlLineReader: vi.fn((_stream: NodeJS.ReadableStream, onLine: (line: string) => void) => {
		rpcIo.lineHandler = onLine;
		return () => {};
	}),
	serializeJsonLine: (value: unknown) => `${JSON.stringify(value)}\n`,
}));

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createAssistantMessage(text: string, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
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

type ParsedOutputLine = Record<string, unknown>;

function getResponses(outputLines: string[], id: string): ParsedOutputLine[] {
	return outputLines
		.flatMap((line) => line.split("\n"))
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as ParsedOutputLine)
		.filter((record) => record.id === id && record.type === "response");
}

async function startRpcMode(): Promise<{
	lineHandler: (line: string) => void;
	cleanup: () => Promise<void>;
}> {
	rpcIo.outputLines = [];
	rpcIo.lineHandler = undefined;

	const tempDir = join(tmpdir(), `pi-rpc-abort-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });

	const model = getModel("anthropic", "claude-sonnet-4-5");
	if (!model) {
		throw new Error("Test model not found");
	}

	const agent = new Agent({
		getApiKey: () => "test-key",
		initialState: {
			model,
			systemPrompt: "Test",
			tools: [],
		},
		streamFn: (_model, _context, options) => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				stream.push({ type: "start", partial: createAssistantMessage("") });
				const timer = setTimeout(() => {
					stream.push({ type: "done", reason: "stop", message: createAssistantMessage("done") });
				}, 5000);
				options?.signal?.addEventListener(
					"abort",
					() => {
						clearTimeout(timer);
						stream.push({
							type: "error",
							reason: "aborted",
							error: createAssistantMessage("", "aborted"),
						});
					},
					{ once: true },
				);
			});
			return stream;
		},
	});

	const sessionManager = SessionManager.inMemory();
	const settingsManager = SettingsManager.create(tempDir, tempDir);
	const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
	const modelRegistry = ModelRegistry.create(authStorage, tempDir);
	authStorage.setRuntimeApiKey("anthropic", "test-key");

	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager,
		cwd: tempDir,
		modelRegistry,
		resourceLoader: createTestResourceLoader(),
	});

	const runtimeHost = {
		session,
		newSession: vi.fn(async () => ({ cancelled: true })),
		switchSession: vi.fn(async () => ({ cancelled: true })),
		fork: vi.fn(async () => ({ cancelled: true, selectedText: "" })),
		dispose: vi.fn(async () => {}),
		setRebindSession: vi.fn(),
	} as unknown as AgentSessionRuntime;

	void runRpcMode(runtimeHost);
	await vi.waitFor(() => expect(rpcIo.lineHandler).toBeDefined());

	return {
		lineHandler: rpcIo.lineHandler!,
		cleanup: async () => {
			try {
				if (session.isStreaming) {
					await session.abort();
				}
			} catch {
				// ignore test cleanup failures
			}
			session.dispose();
			if (existsSync(tempDir)) {
				rmSync(tempDir, { recursive: true });
			}
		},
	};
}

describe("RPC abort clearQueue", () => {
	afterEach(() => {
		rpcIo.outputLines = [];
		rpcIo.lineHandler = undefined;
	});

	it("clears queued follow-ups on abort and returns their texts", async () => {
		const { lineHandler, cleanup } = await startRpcMode();

		try {
			lineHandler(JSON.stringify({ id: "a1", type: "prompt", message: "Start" }));
			await vi.waitFor(() => {
				expect(getResponses(rpcIo.outputLines, "a1")).toHaveLength(1);
			});

			lineHandler(
				JSON.stringify({ id: "a2", type: "prompt", message: "Queued message", streamingBehavior: "followUp" }),
			);
			await vi.waitFor(() => {
				expect(getResponses(rpcIo.outputLines, "a2")).toHaveLength(1);
			});

			lineHandler(JSON.stringify({ id: "a2s", type: "steer", message: "Steered message" }));
			await vi.waitFor(() => {
				expect(getResponses(rpcIo.outputLines, "a2s")).toHaveLength(1);
			});

			lineHandler(JSON.stringify({ id: "a3", type: "abort", clearQueue: true }));
			await vi.waitFor(() => {
				const responses = getResponses(rpcIo.outputLines, "a3");
				expect(responses).toHaveLength(1);
				expect(responses[0]).toMatchObject({
					id: "a3",
					type: "response",
					command: "abort",
					success: true,
					data: { clearedQueue: { steering: ["Steered message"], followUp: ["Queued message"] } },
				});
			});

			lineHandler(JSON.stringify({ id: "a4", type: "get_state" }));
			await vi.waitFor(() => {
				const responses = getResponses(rpcIo.outputLines, "a4");
				expect(responses).toHaveLength(1);
				const state = responses[0].data as { pendingMessageCount: number; isStreaming: boolean };
				expect(state.pendingMessageCount).toBe(0);
				// No post-run continuation: the queue was cleared before the abort
				// settled, so the cleared message must not start a new run.
				expect(state.isStreaming).toBe(false);
			});
		} finally {
			await cleanup();
		}
	});

	it("auto-continues queued follow-ups when abort omits clearQueue", async () => {
		const { lineHandler, cleanup } = await startRpcMode();

		try {
			lineHandler(JSON.stringify({ id: "b1", type: "prompt", message: "Start" }));
			await vi.waitFor(() => {
				expect(getResponses(rpcIo.outputLines, "b1")).toHaveLength(1);
			});

			lineHandler(
				JSON.stringify({ id: "b2", type: "prompt", message: "Survives abort", streamingBehavior: "followUp" }),
			);
			await vi.waitFor(() => {
				expect(getResponses(rpcIo.outputLines, "b2")).toHaveLength(1);
			});

			lineHandler(JSON.stringify({ id: "b3", type: "abort" }));
			await vi.waitFor(() => {
				const responses = getResponses(rpcIo.outputLines, "b3");
				expect(responses).toHaveLength(1);
				expect(responses[0]).toMatchObject({ command: "abort", success: true });
				expect(responses[0].data).toBeUndefined();
			});

			// The post-run settlement loop delivers the queued message as a new
			// run: the queue drains and the delivered user message is emitted.
			await vi.waitFor(() => {
				const delivered = rpcIo.outputLines
					.flatMap((line) => line.split("\n"))
					.filter((line) => line.trim().length > 0)
					.map((line) => JSON.parse(line) as ParsedOutputLine)
					.some((record) => record.type === "message_start" && JSON.stringify(record).includes("Survives abort"));
				expect(delivered).toBe(true);
			});

			lineHandler(JSON.stringify({ id: "b4", type: "get_state" }));
			await vi.waitFor(() => {
				const responses = getResponses(rpcIo.outputLines, "b4");
				expect(responses).toHaveLength(1);
				expect((responses[0].data as { pendingMessageCount: number }).pendingMessageCount).toBe(0);
			});
		} finally {
			await cleanup();
		}
	});
});
