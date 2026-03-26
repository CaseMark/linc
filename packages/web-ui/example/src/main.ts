import "@mariozechner/mini-lit/dist/ThemeToggle.js";
import { Agent, type AgentMessage } from "@casemark/linc-agent-core";
import { type Model, type Api, registerModels } from "@casemark/linc-ai";
import {
	type AgentState,
	AppStorage,
	ChatPanel,
	CustomProvidersStore,
	createJavaScriptReplTool,
	IndexedDBStorageBackend,
	ProviderKeysStore,
	SessionListDialog,
	SessionsStore,
	SettingsStore,
	setAppStorage,
} from "@casemark/linc-web-ui";
import { html, render } from "lit";
import { History, Plus, Settings } from "lucide";
import "./app.css";
import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { customConvertToLlm, registerCustomMessageRenderers } from "./custom-messages.js";

// In dev, Vite proxies /api/casedev → https://api.case.dev to avoid CORS.
// In production, set VITE_CASEDEV_API_BASE to the real URL (or use a backend proxy).
const CASEDEV_API_PATH = import.meta.env.VITE_CASEDEV_API_BASE || "/api/casedev/llm/v1";
const CASEDEV_API_BASE = CASEDEV_API_PATH.startsWith("http") ? CASEDEV_API_PATH : `${window.location.origin}${CASEDEV_API_PATH}`;
const CASEDEV_CONSOLE_URL = "https://console.case.dev";

// Register custom message renderers
registerCustomMessageRenderers();

// Create stores
const settings = new SettingsStore();
const providerKeys = new ProviderKeysStore();
const sessions = new SessionsStore();
const customProviders = new CustomProvidersStore();

const configs = [
	settings.getConfig(),
	SessionsStore.getMetadataConfig(),
	providerKeys.getConfig(),
	customProviders.getConfig(),
	sessions.getConfig(),
];

const backend = new IndexedDBStorageBackend({
	dbName: "linc-web-ui",
	version: 2,
	stores: configs,
});

settings.setBackend(backend);
providerKeys.setBackend(backend);
customProviders.setBackend(backend);
sessions.setBackend(backend);

const storage = new AppStorage(settings, providerKeys, sessions, customProviders, backend);
setAppStorage(storage);

// ============================================================================
// CASE.DEV MODEL FETCHING
// ============================================================================

let casedevModels: Model<Api>[] = [];

async function fetchModels(apiKey: string): Promise<Model<Api>[]> {
	try {
		const res = await fetch(`${CASEDEV_API_BASE}/models`, {
			headers: { Authorization: `Bearer ${apiKey}` },
		});
		if (!res.ok) return [];
		const body = await res.json();
		const data: any[] = Array.isArray(body) ? body : (body.data || []);

		return data.map((m: any) => ({
			id: m.id,
			name: m.name || m.id,
			api: "openai-completions" as const,
			provider: "casedev",
			baseUrl: CASEDEV_API_BASE,
			reasoning: m.reasoning ?? (m.id.includes("o1") || m.id.includes("o3") || m.id.includes("o4") || m.id.includes("opus")),
			input: m.input ?? ["text"] as ("text" | "image")[],
			cost: m.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: m.context_window ?? m.contextWindow ?? 128000,
			maxTokens: m.max_tokens ?? m.maxTokens ?? 16384,
		}));
	} catch {
		return [];
	}
}

function getDefaultModel(): Model<"openai-completions"> {
	const found = casedevModels.find((m) => m.id === "anthropic/claude-sonnet-4-5-20250514");
	if (found) return found as Model<"openai-completions">;

	if (casedevModels.length > 0) return casedevModels[0] as Model<"openai-completions">;

	return {
		id: "anthropic/claude-sonnet-4-5-20250514",
		name: "Claude Sonnet 4.5",
		api: "openai-completions",
		provider: "casedev",
		baseUrl: CASEDEV_API_BASE,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 16384,
	};
}

// ============================================================================
// DEVICE FLOW AUTH
// ============================================================================

interface DeviceFlowStart {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete: string;
	interval: number;
	expiresIn: number;
	expiresAt: string;
}

async function startDeviceFlow(): Promise<DeviceFlowStart | null> {
	try {
		const res = await fetch(`/api/casedev/auth/cli/start`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				scopes: { services: [{ service: "all", scopes: ["read", "write"] }] },
			}),
		});
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	}
}

async function pollDeviceFlow(deviceCode: string, interval: number, expiresAt: string): Promise<string | null> {
	const expiry = new Date(expiresAt).getTime();
	const pollMs = interval * 1000;

	while (Date.now() < expiry) {
		await new Promise((r) => setTimeout(r, pollMs));
		try {
			const res = await fetch(`/api/casedev/auth/cli/poll`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ deviceCode }),
			});
			if (res.status === 200) {
				const data = await res.json();
				if (data.apiKey) return data.apiKey;
			}
			if (res.status === 429) {
				await new Promise((r) => setTimeout(r, pollMs));
				continue;
			}
			if (res.status === 403 || res.status === 410) return null;
		} catch {
			continue;
		}
	}
	return null;
}

// ============================================================================
// AUTH SCREEN
// ============================================================================

function renderAuthScreen(app: HTMLElement) {
	// Device flow disabled in browser until CORS is added to /auth/cli/* (CD-754)
	// Skip straight to API key input
	let mode: "choice" | "device" | "apikey" | "device-waiting" = "apikey";
	let deviceFlowData: DeviceFlowStart | null = null;
	let error = "";

	const doRender = () => {
		const authHtml = html`
			<div class="w-full h-screen flex items-center justify-center bg-background text-foreground">
				<div class="max-w-md w-full p-8">
					<h1 class="text-2xl font-bold mb-2">Linc</h1>
					<p class="text-muted-foreground mb-8">Legal AI powered by case.dev</p>

					${mode === "choice" ? html`
						<div class="space-y-3">
							${Button({
								variant: "default",
								className: "w-full justify-center",
								children: html`Sign in with case.dev`,
								onClick: async () => {
									mode = "device-waiting";
									error = "";
									doRender();
									deviceFlowData = await startDeviceFlow();
									if (!deviceFlowData) {
										error = "Failed to start authentication. Check your connection.";
										mode = "choice";
										doRender();
										return;
									}
									mode = "device";
									doRender();
									// Open browser
									window.open(deviceFlowData.verificationUriComplete, "_blank");
									// Start polling
									const apiKey = await pollDeviceFlow(
										deviceFlowData.deviceCode,
										deviceFlowData.interval || 3,
										deviceFlowData.expiresAt,
									);
									if (apiKey) {
										await providerKeys.set("casedev", apiKey);
										await initApp();
									} else {
										error = "Authentication timed out or was denied.";
										mode = "choice";
										doRender();
									}
								},
							})}
							${Button({
								variant: "outline",
								className: "w-full justify-center",
								children: html`Paste API key`,
								onClick: () => { mode = "apikey"; doRender(); },
							})}
						</div>
						${error ? html`<p class="text-destructive text-sm mt-4">${error}</p>` : ""}
					` : ""}

					${mode === "device-waiting" ? html`
						<div class="text-center">
							<div class="text-muted-foreground">Starting authentication...</div>
						</div>
					` : ""}

					${mode === "device" && deviceFlowData ? html`
						<div class="space-y-4">
							<p class="text-sm text-muted-foreground">A browser window has opened. Approve the request to continue.</p>
							<div class="bg-secondary p-4 rounded-lg text-center">
								<div class="text-xs text-muted-foreground mb-1">Your code</div>
								<div class="text-2xl font-mono font-bold tracking-widest">${deviceFlowData.userCode}</div>
							</div>
							<p class="text-xs text-muted-foreground">
								Or visit: <a href="${deviceFlowData.verificationUriComplete}" target="_blank" class="text-primary underline">${deviceFlowData.verificationUriComplete}</a>
							</p>
							<div class="flex items-center gap-2 text-muted-foreground text-sm">
								<svg class="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
								</svg>
								Waiting for approval...
							</div>
						</div>
					` : ""}

					${mode === "apikey" ? html`
						<div class="space-y-4">
							<p class="text-sm text-muted-foreground">
								Enter your case.dev API key. Get one at
								<a href="${CASEDEV_CONSOLE_URL}" target="_blank" class="text-primary underline">console.case.dev</a>
							</p>
							<input
								id="api-key-input"
								type="password"
								placeholder="sk_case_..."
								class="w-full px-3 py-2 bg-secondary border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
							/>
							${error ? html`<p class="text-destructive text-sm">${error}</p>` : ""}
							<div class="flex gap-2">
								${Button({
									variant: "default",
									children: html`Verify & Save`,
									onClick: async () => {
										const input = document.getElementById("api-key-input") as HTMLInputElement;
										const key = input?.value?.trim();
										if (!key) { error = "Please enter an API key."; doRender(); return; }
										if (!key.startsWith("sk_case_")) { error = "Invalid key. case.dev keys start with sk_case_"; doRender(); return; }

										error = "";
										doRender();

										try {
											const res = await fetch(`${CASEDEV_API_BASE}/models`, {
												headers: { Authorization: `Bearer ${key}` },
											});
											if (!res.ok) {
												error = `Key verification failed (${res.status})`;
												doRender();
												return;
											}
										} catch {
											error = "Failed to reach case.dev.";
											doRender();
											return;
										}

										await providerKeys.set("casedev", key);
										await initApp();
									},
								})}
								${Button({
									variant: "ghost",
									children: html`Back`,
									onClick: () => { mode = "choice"; error = ""; doRender(); },
								})}
							</div>
						</div>
					` : ""}
				</div>
			</div>
		`;
		render(authHtml, app);
	};

	doRender();
}

// ============================================================================
// SESSION / AGENT MANAGEMENT
// ============================================================================

let currentSessionId: string | undefined;
let currentTitle = "";
let isEditingTitle = false;
let agent: Agent;
let chatPanel: ChatPanel;
let agentUnsubscribe: (() => void) | undefined;

const generateTitle = (messages: AgentMessage[]): string => {
	const firstUserMsg = messages.find((m) => m.role === "user" || m.role === "user-with-attachments");
	if (!firstUserMsg || (firstUserMsg.role !== "user" && firstUserMsg.role !== "user-with-attachments")) return "";
	let text = "";
	const content = firstUserMsg.content;
	if (typeof content === "string") { text = content; } else {
		text = content.filter((c: any) => c.type === "text").map((c: any) => c.text || "").join(" ");
	}
	text = text.trim();
	if (!text) return "";
	const sentenceEnd = text.search(/[.!?]/);
	if (sentenceEnd > 0 && sentenceEnd <= 50) return text.substring(0, sentenceEnd + 1);
	return text.length <= 50 ? text : `${text.substring(0, 47)}...`;
};

const shouldSaveSession = (messages: AgentMessage[]): boolean => {
	return messages.some((m: any) => m.role === "user" || m.role === "user-with-attachments")
		&& messages.some((m: any) => m.role === "assistant");
};

const saveSession = async () => {
	if (!storage.sessions || !currentSessionId || !agent || !currentTitle) return;
	const state = agent.state;
	if (!shouldSaveSession(state.messages)) return;
	try {
		const now = new Date().toISOString();
		await storage.sessions.save(
			{ id: currentSessionId, title: currentTitle, model: state.model!, thinkingLevel: state.thinkingLevel, messages: state.messages, createdAt: now, lastModified: now },
			{ id: currentSessionId, title: currentTitle, createdAt: now, lastModified: now, messageCount: state.messages.length, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, modelId: state.model?.id || null, thinkingLevel: state.thinkingLevel, preview: generateTitle(state.messages) },
		);
	} catch (err) { console.error("Failed to save session:", err); }
};

const updateUrl = (sessionId: string) => {
	const url = new URL(window.location.href);
	url.searchParams.set("session", sessionId);
	window.history.replaceState({}, "", url);
};

const createAgent = async (initialState?: Partial<AgentState>) => {
	if (agentUnsubscribe) agentUnsubscribe();

	agent = new Agent({
		initialState: initialState || {
			systemPrompt: `You are a helpful legal AI assistant powered by case.dev. You have access to tools including a JavaScript REPL and artifacts.`,
			model: getDefaultModel(),
			thinkingLevel: "off",
			messages: [],
			tools: [],
		},
		convertToLlm: customConvertToLlm,
	});

	agentUnsubscribe = agent.subscribe((event: any) => {
		if (event.type === "state-update") {
			const messages = event.state.messages;
			if (!currentTitle && shouldSaveSession(messages)) currentTitle = generateTitle(messages);
			if (!currentSessionId && shouldSaveSession(messages)) { currentSessionId = crypto.randomUUID(); updateUrl(currentSessionId); }
			if (currentSessionId) saveSession();
			renderApp();
		}
	});

	await chatPanel.setAgent(agent, {
		onApiKeyRequired: async (_provider: string) => {
			// Key should already be set — but just in case, check storage
			const key = await providerKeys.get("casedev");
			return !!key;
		},
		toolsFactory: (_agent, _agentInterface, _artifactsPanel, runtimeProvidersFactory) => {
			const replTool = createJavaScriptReplTool();
			replTool.runtimeProvidersFactory = runtimeProvidersFactory;
			return [replTool];
		},
	});
};

const loadSession = async (sessionId: string): Promise<boolean> => {
	if (!storage.sessions) return false;
	const sessionData = await storage.sessions.get(sessionId);
	if (!sessionData) return false;
	currentSessionId = sessionId;
	const metadata = await storage.sessions.getMetadata(sessionId);
	currentTitle = metadata?.title || "";
	await createAgent({ model: sessionData.model, thinkingLevel: sessionData.thinkingLevel, messages: sessionData.messages, tools: [] });
	updateUrl(sessionId);
	renderApp();
	return true;
};

const newSession = () => {
	const url = new URL(window.location.href);
	url.search = "";
	window.location.href = url.toString();
};

// ============================================================================
// MODEL SELECTOR (simplified — dropdown instead of full dialog)
// ============================================================================

function renderModelSelector() {
	if (casedevModels.length === 0) return html``;
	const currentModelId = agent?.state?.model?.id || "";
	return html`
		<select
			class="bg-secondary border border-border rounded px-2 py-1 text-xs text-foreground"
			@change=${(e: Event) => {
				const id = (e.target as HTMLSelectElement).value;
				const model = casedevModels.find((m) => m.id === id);
				if (model && agent) agent.model = model;
			}}
		>
			${casedevModels.map((m) => html`
				<option value=${m.id} ?selected=${m.id === currentModelId}>${m.id}</option>
			`)}
		</select>
	`;
}

// ============================================================================
// RENDER
// ============================================================================

const renderApp = () => {
	const app = document.getElementById("app");
	if (!app) return;

	const appHtml = html`
		<div class="w-full h-screen flex flex-col bg-background text-foreground overflow-hidden">
			<div class="flex items-center justify-between border-b border-border shrink-0">
				<div class="flex items-center gap-2 px-4 py-1">
					${Button({ variant: "ghost", size: "sm", children: icon(History, "sm"), onClick: () => {
						SessionListDialog.open(async (sid) => { await loadSession(sid); }, (did) => { if (did === currentSessionId) newSession(); });
					}, title: "Sessions" })}
					${Button({ variant: "ghost", size: "sm", children: icon(Plus, "sm"), onClick: newSession, title: "New Session" })}
					${currentTitle
						? isEditingTitle
							? html`<div class="flex items-center gap-2">${Input({
								type: "text", value: currentTitle, className: "text-sm w-64",
								onChange: async (e: Event) => { const t = (e.target as HTMLInputElement).value.trim(); if (t && t !== currentTitle && storage.sessions && currentSessionId) { await storage.sessions.updateTitle(currentSessionId, t); currentTitle = t; } isEditingTitle = false; renderApp(); },
								onKeyDown: async (e: KeyboardEvent) => { if (e.key === "Enter") { const t = (e.target as HTMLInputElement).value.trim(); if (t && t !== currentTitle && storage.sessions && currentSessionId) { await storage.sessions.updateTitle(currentSessionId, t); currentTitle = t; } isEditingTitle = false; renderApp(); } else if (e.key === "Escape") { isEditingTitle = false; renderApp(); } },
							})}</div>`
							: html`<button class="px-2 py-1 text-sm text-foreground hover:bg-secondary rounded transition-colors" @click=${() => { isEditingTitle = true; renderApp(); requestAnimationFrame(() => { const i = app?.querySelector('input[type="text"]') as HTMLInputElement; if (i) { i.focus(); i.select(); } }); }} title="Click to edit title">${currentTitle}</button>`
						: html`<span class="text-base font-semibold text-foreground">Linc</span>`
					}
				</div>
				<div class="flex items-center gap-2 px-4">
					${renderModelSelector()}
					<theme-toggle></theme-toggle>
					${Button({ variant: "ghost", size: "sm", children: html`<span class="text-xs">Logout</span>`, onClick: async () => {
						await providerKeys.delete("casedev");
						window.location.reload();
					}, title: "Logout" })}
				</div>
			</div>
			${chatPanel}
		</div>
	`;
	render(appHtml, app);
};

// ============================================================================
// INIT
// ============================================================================

async function initApp() {
	const app = document.getElementById("app");
	if (!app) throw new Error("App container not found");

	// Check for stored API key
	const apiKey = await providerKeys.get("casedev");
	if (!apiKey) {
		renderAuthScreen(app);
		return;
	}

	// Show loading
	render(html`<div class="w-full h-screen flex items-center justify-center bg-background text-foreground"><div class="text-muted-foreground">Loading models...</div></div>`, app);

	// Fetch models
	casedevModels = await fetchModels(apiKey);
	// Register into linc-ai registry so built-in ModelSelector can find them
	registerModels(casedevModels);
	if (casedevModels.length === 0) {
		// Key might be invalid
		renderAuthScreen(app);
		return;
	}

	// Create ChatPanel
	chatPanel = new ChatPanel();

	// Check for session in URL
	const urlParams = new URLSearchParams(window.location.search);
	const sessionIdFromUrl = urlParams.get("session");

	if (sessionIdFromUrl) {
		const loaded = await loadSession(sessionIdFromUrl);
		if (!loaded) { newSession(); return; }
	} else {
		await createAgent();
	}

	renderApp();
}

initApp();
