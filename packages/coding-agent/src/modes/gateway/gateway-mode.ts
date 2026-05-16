import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { AgentMessage, ThinkingLevel } from "@casemark/linc-agent-core";
import { type Api, type AssistantMessage, loadModels, type Model } from "@casemark/linc-ai";
import { getAgentDir } from "../../config.js";
import type { AgentSession, AgentSessionEvent } from "../../core/agent-session.js";
import { AuthStorage } from "../../core/auth-storage.js";
import { ModelRegistry } from "../../core/model-registry.js";
import { type CreateAgentSessionOptions, createAgentSession } from "../../core/sdk.js";
import { SessionManager } from "../../core/session-manager.js";
import type {
	OpenAIChatCompletion,
	OpenAIChatCompletionChunk,
	OpenAIChatCompletionRequest,
	OpenAIChatMessage,
	OpenAIModelList,
	OpenAIModelObject,
} from "./openai-types.js";

const DEFAULT_GATEWAY_HOST = "127.0.0.1";
const DEFAULT_GATEWAY_PORT = 8642;
const DEFAULT_AGENT_MODEL_ID = "linc/default";
const AGENT_MODEL_PREFIX = "linc/";

export interface GatewayModel {
	id: string;
	model?: Model<Api>;
	thinkingLevel?: ThinkingLevel;
}

export interface GatewayOptions {
	host?: string;
	port?: number;
	apiKey?: string;
	cwd?: string;
	agentDir?: string;
	createSession?: (modelId: string) => Promise<AgentSession>;
	listModels?: () => Promise<GatewayModel[]>;
	log?: (message: string) => void;
}

export interface GatewayHandle {
	server: Server;
	url: string;
	close: () => Promise<void>;
}

class GatewayHttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

function completionId(): string {
	return `chatcmpl_linc_${randomUUID().replace(/-/g, "")}`;
}

function parsePort(value: string | undefined): number {
	if (!value) return DEFAULT_GATEWAY_PORT;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
		throw new Error(`Invalid gateway port: ${value}`);
	}
	return parsed;
}

function modelToGatewayId(model: Model<Api>): string {
	return `${AGENT_MODEL_PREFIX}${model.provider}/${model.id}`;
}

function gatewayIdToProviderModel(id: string): { provider: string; modelId: string } | undefined {
	if (!id.startsWith(AGENT_MODEL_PREFIX) || id === DEFAULT_AGENT_MODEL_ID) {
		return undefined;
	}
	const rest = id.slice(AGENT_MODEL_PREFIX.length);
	const slash = rest.indexOf("/");
	if (slash <= 0 || slash === rest.length - 1) {
		return undefined;
	}
	return {
		provider: rest.slice(0, slash),
		modelId: rest.slice(slash + 1),
	};
}

function resolveGatewayModelId(modelId: string): { provider: string; modelId: string } | undefined {
	if (modelId === DEFAULT_AGENT_MODEL_ID) {
		return undefined;
	}
	const requested = gatewayIdToProviderModel(modelId);
	if (!requested) {
		throw new GatewayHttpError(404, `Model "${modelId}" was not found.`);
	}
	return requested;
}

function extractContentText(message: OpenAIChatMessage): string {
	if (message.content === null) return "";
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) {
		throw new GatewayHttpError(400, `Unsupported content for role "${message.role}".`);
	}
	return message.content
		.map((part) => {
			if (part.type !== "text" || typeof part.text !== "string") {
				throw new GatewayHttpError(400, "Only text message content parts are supported.");
			}
			return part.text;
		})
		.join("");
}

function openAIMessageToAgentMessage(message: OpenAIChatMessage): AgentMessage {
	const text = extractContentText(message);
	if (message.role === "assistant") {
		return {
			role: "assistant",
			content: text ? [{ type: "text", text }] : [],
			api: "openai-completions",
			provider: "openai-compatible",
			model: "unknown",
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
		} satisfies AssistantMessage;
	}
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

function parseRequestBody(body: unknown): OpenAIChatCompletionRequest {
	if (!body || typeof body !== "object") {
		throw new GatewayHttpError(400, "Request body must be a JSON object.");
	}
	const candidate = body as Partial<OpenAIChatCompletionRequest>;
	if (typeof candidate.model !== "string" || candidate.model.length === 0) {
		throw new GatewayHttpError(400, 'Missing required string field "model".');
	}
	if (!Array.isArray(candidate.messages) || candidate.messages.length === 0) {
		throw new GatewayHttpError(400, 'Missing required non-empty array field "messages".');
	}
	for (const message of candidate.messages) {
		if (!message || typeof message !== "object") {
			throw new GatewayHttpError(400, "Each message must be an object.");
		}
		if (message.role !== "system" && message.role !== "user" && message.role !== "assistant") {
			throw new GatewayHttpError(400, `Unsupported message role "${String(message.role)}".`);
		}
		extractContentText(message);
	}
	return {
		model: candidate.model,
		messages: candidate.messages,
		stream: candidate.stream === true,
	};
}

function getPromptParts(messages: OpenAIChatMessage[]): {
	history: AgentMessage[];
	finalPrompt: string;
} {
	let finalUserIndex = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "user") {
			finalUserIndex = i;
			break;
		}
	}
	if (finalUserIndex === -1) {
		throw new GatewayHttpError(400, "At least one user message is required.");
	}
	const systemText = messages
		.filter((message) => message.role === "system")
		.map(extractContentText)
		.filter((text) => text.trim().length > 0)
		.join("\n\n");
	const history = messages
		.slice(0, finalUserIndex)
		.filter((message) => message.role !== "system")
		.map(openAIMessageToAgentMessage);
	const finalUserText = extractContentText(messages[finalUserIndex]);
	const finalPrompt = systemText
		? `Client system instructions:\n${systemText}\n\nUser request:\n${finalUserText}`
		: finalUserText;
	return { history, finalPrompt };
}

function getAssistantText(message: AssistantMessage | undefined): string {
	if (!message) return "";
	return message.content
		.filter((content): content is { type: "text"; text: string } => content.type === "text")
		.map((content) => content.text)
		.join("");
}

function getLastAssistantMessage(session: AgentSession): AssistantMessage | undefined {
	for (let i = session.messages.length - 1; i >= 0; i--) {
		const message = session.messages[i];
		if (message.role === "assistant") {
			return message as AssistantMessage;
		}
	}
	return undefined;
}

function createChunk(id: string, model: string, content: string, finishReason: null): OpenAIChatCompletionChunk;
function createChunk(
	id: string,
	model: string,
	content: string,
	finishReason: "stop" | "length" | "tool_calls" | "content_filter",
): OpenAIChatCompletionChunk;
function createChunk(
	id: string,
	model: string,
	content: string,
	finishReason: "stop" | "length" | "tool_calls" | "content_filter" | null,
): OpenAIChatCompletionChunk {
	return {
		id,
		object: "chat.completion.chunk",
		created: nowSeconds(),
		model,
		choices: [
			{
				index: 0,
				delta: content ? { content } : {},
				finish_reason: finishReason,
			},
		],
	};
}

function createTextCompletion(id: string, model: string, content: string): OpenAIChatCompletion {
	return {
		id,
		object: "chat.completion",
		created: nowSeconds(),
		model,
		choices: [
			{
				index: 0,
				message: { role: "assistant", content },
				finish_reason: "stop",
			},
		],
	};
}

function createModelList(models: GatewayModel[]): OpenAIModelList {
	const byId = new Map<string, OpenAIModelObject>();
	for (const model of models) {
		byId.set(model.id, {
			id: model.id,
			object: "model",
			created: 0,
			owned_by: "linc",
		});
	}
	return {
		object: "list",
		data: Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id)),
	};
}

async function bindGatewayExtensions(session: AgentSession): Promise<void> {
	await session.bindExtensions({
		commandContextActions: {
			waitForIdle: () => session.agent.waitForIdle(),
			newSession: async (options) => {
				const success = await session.newSession({ parentSession: options?.parentSession });
				if (success && options?.setup) {
					await options.setup(session.sessionManager);
				}
				return { cancelled: !success };
			},
			fork: async (entryId) => {
				const result = await session.fork(entryId);
				return { cancelled: result.cancelled };
			},
			navigateTree: async (targetId, options) => {
				const result = await session.navigateTree(targetId, {
					summarize: options?.summarize,
					customInstructions: options?.customInstructions,
					replaceInstructions: options?.replaceInstructions,
					label: options?.label,
				});
				return { cancelled: result.cancelled };
			},
			switchSession: async (sessionPath) => {
				const success = await session.switchSession(sessionPath);
				return { cancelled: !success };
			},
			reload: async () => {
				await session.reload();
			},
		},
		onError: (err) => {
			console.error(`Extension error (${err.extensionPath}): ${err.error}`);
		},
	});
}

async function createRegistry(agentDir: string): Promise<{ authStorage: AuthStorage; modelRegistry: ModelRegistry }> {
	const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
	await loadModels(await authStorage.getApiKey());
	return {
		authStorage,
		modelRegistry: new ModelRegistry(authStorage, join(agentDir, "models.json")),
	};
}

async function createDefaultSession(modelId: string, options: GatewayOptions): Promise<AgentSession> {
	const agentDir = options.agentDir ?? getAgentDir();
	const { authStorage, modelRegistry } = await createRegistry(agentDir);
	const requested = resolveGatewayModelId(modelId);
	let model: Model<Api> | undefined;
	if (requested) {
		model = modelRegistry.find(requested.provider, requested.modelId);
		if (!model) {
			throw new GatewayHttpError(404, `Model "${modelId}" was not found.`);
		}
	}
	const sessionOptions: CreateAgentSessionOptions = {
		cwd: options.cwd ?? process.cwd(),
		agentDir,
		authStorage,
		modelRegistry,
		sessionManager: SessionManager.inMemory(),
		model,
	};
	const { session } = await createAgentSession(sessionOptions);
	await bindGatewayExtensions(session);
	return session;
}

async function listDefaultModels(options: GatewayOptions): Promise<GatewayModel[]> {
	const agentDir = options.agentDir ?? getAgentDir();
	const { modelRegistry } = await createRegistry(agentDir);
	return [
		{ id: DEFAULT_AGENT_MODEL_ID },
		...modelRegistry.getAvailable().map((model) => ({ id: modelToGatewayId(model), model })),
	];
}

async function readJson(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	if (chunks.length === 0) {
		return undefined;
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new GatewayHttpError(400, `Invalid JSON request body: ${message}`);
	}
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
}

function writeError(res: ServerResponse, status: number, message: string): void {
	writeJson(res, status, {
		error: {
			message,
			type: "invalid_request_error",
		},
	});
}

function assertAuthorized(req: IncomingMessage, apiKey: string | undefined): void {
	if (!apiKey) return;
	const auth = req.headers.authorization;
	if (auth !== `Bearer ${apiKey}`) {
		throw new GatewayHttpError(401, "Invalid or missing bearer token.");
	}
}

function writeSse(res: ServerResponse, payload: unknown): void {
	res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function runCompletion(
	request: OpenAIChatCompletionRequest,
	session: AgentSession,
	onDelta?: (text: string) => void,
): Promise<string> {
	const { history, finalPrompt } = getPromptParts(request.messages);
	session.agent.replaceMessages(history);
	const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
		if (event.type !== "message_update") return;
		const update = event.assistantMessageEvent;
		if (update.type === "text_delta") {
			onDelta?.(update.delta);
		}
	});
	try {
		await session.prompt(finalPrompt);
	} finally {
		unsubscribe();
	}
	const assistant = getLastAssistantMessage(session);
	if (assistant?.stopReason === "error" || assistant?.stopReason === "aborted") {
		throw new GatewayHttpError(500, assistant.errorMessage ?? `Agent ${assistant.stopReason}.`);
	}
	return getAssistantText(assistant);
}

async function handleChatCompletions(
	req: IncomingMessage,
	res: ServerResponse,
	options: GatewayOptions,
): Promise<void> {
	const request = parseRequestBody(await readJson(req));
	const createSession = options.createSession ?? ((modelId) => createDefaultSession(modelId, options));
	const session = await createSession(request.model);
	const id = completionId();
	if (request.stream) {
		res.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			connection: "keep-alive",
		});
		writeSse(res, {
			...createChunk(id, request.model, "", null),
			choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
		});
		try {
			await runCompletion(request, session, (delta) => writeSse(res, createChunk(id, request.model, delta, null)));
			writeSse(res, createChunk(id, request.model, "", "stop"));
			res.write("data: [DONE]\n\n");
		} finally {
			session.dispose();
			res.end();
		}
		return;
	}
	try {
		const text = await runCompletion(request, session);
		writeJson(res, 200, createTextCompletion(id, request.model, text));
	} finally {
		session.dispose();
	}
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, options: GatewayOptions): Promise<void> {
	try {
		assertAuthorized(req, options.apiKey ?? process.env.LINC_GATEWAY_API_KEY);
		const method = req.method ?? "GET";
		const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
		if (method === "GET" && url.pathname === "/health") {
			writeJson(res, 200, { status: "ok" });
			return;
		}
		if (method === "GET" && url.pathname === "/v1/models") {
			const models = options.listModels ? await options.listModels() : await listDefaultModels(options);
			writeJson(res, 200, createModelList(models));
			return;
		}
		if (method === "POST" && url.pathname === "/v1/chat/completions") {
			await handleChatCompletions(req, res, options);
			return;
		}
		writeError(res, 404, `No route for ${method} ${url.pathname}.`);
	} catch (error) {
		if (res.headersSent) {
			res.end();
			return;
		}
		if (error instanceof GatewayHttpError) {
			writeError(res, error.status, error.message);
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		writeError(res, 500, message);
	}
}

export async function startGateway(options: GatewayOptions = {}): Promise<GatewayHandle> {
	const host = options.host ?? process.env.LINC_GATEWAY_HOST ?? DEFAULT_GATEWAY_HOST;
	const port = options.port ?? parsePort(process.env.LINC_GATEWAY_PORT);
	const server = createServer((req, res) => {
		void handleRequest(req, res, options);
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, host, () => {
			server.off("error", reject);
			resolve();
		});
	});
	const address = server.address() as AddressInfo;
	return {
		server,
		url: `http://${host}:${address.port}`,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) reject(error);
					else resolve();
				});
			}),
	};
}

export async function runGatewayMode(options: GatewayOptions = {}): Promise<void> {
	const gateway = await startGateway(options);
	options.log?.(`Linc gateway listening on ${gateway.url}`);
	await new Promise<void>(() => {});
}
