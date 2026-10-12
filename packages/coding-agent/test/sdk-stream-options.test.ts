import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Api,
	type AssistantMessage,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createTestResourceLoader } from "./utilities.ts";

describe("createAgentSession stream options", () => {
	let tempDir: string;
	let cwd: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "pi-sdk-stream-options-"));
		cwd = join(tempDir, "project");
		agentDir = join(tempDir, "agent");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	function createModel(api: Api): Model<Api> {
		return {
			id: "capture-model",
			name: "Capture Model",
			api,
			provider: "capture-provider",
			baseUrl: "https://capture.invalid/v1",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 4096,
		};
	}

	function createDoneStream(api: Api) {
		const stream = createAssistantMessageEventStream();
		const message: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
			api,
			provider: "capture-provider",
			model: "capture-model",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};
		stream.end(message);
		return stream;
	}

	async function captureStreamOptions(
		api: Api,
		settings: { httpIdleTimeoutMs?: number; websocketConnectTimeoutMs?: number },
		requestOptions: SimpleStreamOptions = {},
	): Promise<SimpleStreamOptions | undefined> {
		const model = createModel(api);
		const settingsManager = SettingsManager.inMemory(settings);

		const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
		authStorage.setRuntimeApiKey(model.provider, "test-api-key");
		const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
		let capturedOptions: SimpleStreamOptions | undefined;

		modelRegistry.registerProvider(model.provider, {
			api,
			streamSimple: (_model, _context, providerOptions) => {
				capturedOptions = providerOptions;
				return createDoneStream(api);
			},
		});

		const sessionManager = SessionManager.inMemory(cwd);
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			model,
			authStorage,
			modelRegistry,
			settingsManager,
			sessionManager,
		});

		try {
			await session.agent.streamFn(model, { messages: [] }, requestOptions);
			return capturedOptions;
		} finally {
			session.dispose();
			modelRegistry.unregisterProvider(model.provider);
		}
	}

	it("forwards httpIdleTimeoutMs as timeoutMs for OpenAI Codex", async () => {
		const options = await captureStreamOptions("openai-codex-responses", { httpIdleTimeoutMs: 1234 });

		expect(options?.timeoutMs).toBe(1234);
	});

	it("defaults timeoutMs from httpIdleTimeoutMs for all providers", async () => {
		const options = await captureStreamOptions("openai-completions", { httpIdleTimeoutMs: 1234 });

		expect(options?.timeoutMs).toBe(1234);
	});

	it("lets request timeoutMs override httpIdleTimeoutMs for OpenAI Codex", async () => {
		const options = await captureStreamOptions(
			"openai-codex-responses",
			{ httpIdleTimeoutMs: 1234 },
			{ timeoutMs: 0 },
		);

		expect(options?.timeoutMs).toBe(0);
	});

	it("forwards websocketConnectTimeoutMs from settings", async () => {
		const options = await captureStreamOptions("openai-codex-responses", { websocketConnectTimeoutMs: 1234 });

		expect(options?.websocketConnectTimeoutMs).toBe(1234);
	});

	it("lets request websocketConnectTimeoutMs override settings", async () => {
		const options = await captureStreamOptions(
			"openai-codex-responses",
			{ websocketConnectTimeoutMs: 1234 },
			{ websocketConnectTimeoutMs: 0 },
		);

		expect(options?.websocketConnectTimeoutMs).toBe(0);
	});

	it("preserves historical Case.dev images and uploads after the final payload hook", async () => {
		const model = {
			...createModel("openai-completions"),
			provider: "casedev",
			baseUrl: "https://api.case.dev/llm/v1",
			input: ["text", "image"] as ("text" | "image")[],
		};
		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey("casedev", "test-api-key");
		const registry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
		let capturedOptions: SimpleStreamOptions | undefined;
		registry.registerProvider("casedev", {
			api: "openai-completions",
			streamSimple: (_model, _context, opts) => {
				capturedOptions = opts;
				return createDoneStream("openai-completions");
			},
		});
		const upload = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						url: "https://storage.test/image",
						expiresAt: new Date(Date.now() + 3600_000).toISOString(),
					}),
				),
		);
		vi.stubGlobal("fetch", upload);
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			model,
			authStorage,
			modelRegistry: registry,
			settingsManager: SettingsManager.inMemory(),
			sessionManager: SessionManager.inMemory(cwd),
			resourceLoader: createTestResourceLoader(),
		});
		try {
			const data = Buffer.alloc(303_000).toString("base64");
			const content = Array.from({ length: 30 }, () => ({ type: "image" as const, data, mimeType: "image/png" }));
			const messages = await session.agent.convertToLlm([{ role: "user", content, timestamp: Date.now() }]);
			expect(JSON.stringify(messages)).not.toContain("image omitted");
			expect((messages[0].content as unknown[]).length).toBe(30);
			const original = { messages: [{ role: "user", content: [{ type: "text", text: "before" }] }] };
			const rewritten = {
				messages: [
					{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${data}` } }] },
				],
			};
			const hook = vi.fn(() => rewritten);
			const controller = new AbortController();
			await session.agent.streamFn(model, { messages: [] }, { onPayload: hook, signal: controller.signal });
			const result = await capturedOptions?.onPayload?.(original, model);
			expect(hook).toHaveBeenCalledWith(original, model);
			expect(JSON.stringify(result)).toContain("https://storage.test/image");
			expect(JSON.stringify(result)).not.toContain("data:image");
			expect(upload).toHaveBeenCalledTimes(1);
		} finally {
			session.dispose();
			registry.unregisterProvider("casedev");
		}
	});
});
