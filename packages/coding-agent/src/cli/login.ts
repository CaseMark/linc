/**
 * linc login — authenticate with Core OAuth tokens or case.dev API keys.
 */

import chalk from "chalk";
import { execSync } from "child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { createInterface } from "readline";
import { AuthStorage } from "../core/auth-storage.js";

const CASEDEV_API_BASE = process.env.CASEDEV_API_BASE_URL || "https://api.case.dev";
const CASEDEV_LLM_BASE = `${CASEDEV_API_BASE.replace(/\/+$/, "")}/llm/v1`;
const CORE_API_BASE = process.env.CORE_API_BASE_URL || "https://core.case.dev";
const CORE_LLM_BASE = `${CORE_API_BASE.replace(/\/+$/, "")}/v1`;
const CORE_OAUTH_CLIENT_ID = process.env.LINC_CORE_OAUTH_CLIENT_ID || "linc";
const CORE_OAUTH_SCOPE = process.env.LINC_CORE_OAUTH_SCOPE || "core:chat";

interface DeviceFlowStartResponse {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete: string;
	interval: number;
	expiresIn: number;
	expiresAt: string;
}

interface DeviceFlowPollResponse {
	error?: string;
	interval?: number;
	tokenType?: string;
	apiKey?: string;
	expiresAt?: string | null;
	scope?: { services: Array<{ service: string; scopes: string[] }> };
}

interface CoreDeviceCodeResponse {
	device_code: string;
	user_code: string;
	verification_uri: string;
	verification_uri_complete: string;
	interval?: number;
	expires_in: number;
}

interface CoreTokenResponse {
	access_token?: string;
	refresh_token?: string;
	token_type?: string;
	expires_in?: number;
	scope?: string;
	error?: string;
	error_description?: string;
}

type LoginTarget = "core" | "casedev" | "manual";
const CASEDEV_PROVIDER_ID = "casedev";
const CASEMARK_CORE_PROVIDER_ID = "casemark-core";

function ask(prompt: string): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stderr });
	return new Promise((resolve) => {
		rl.question(prompt, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

function openUrl(url: string): void {
	try {
		if (process.platform === "darwin") {
			execSync(`open "${url}"`, { stdio: "ignore" });
		} else if (process.platform === "linux") {
			execSync(`xdg-open "${url}"`, { stdio: "ignore" });
		} else if (process.platform === "win32") {
			execSync(`start "" "${url}"`, { stdio: "ignore" });
		}
	} catch {
		// Silently fail — user can click the link
	}
}

function clickableLink(url: string, label?: string): string {
	// OSC 8 hyperlink escape sequence — makes URLs clickable in modern terminals
	const text = label || url;
	return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

function isCoreAccessToken(token: string): boolean {
	return token.startsWith("core_at_");
}

function setProcessAuthToken(token: string): void {
	if (isCoreAccessToken(token)) {
		process.env.CORE_ACCESS_TOKEN = token;
		delete process.env.CASEDEV_API_KEY;
		return;
	}
	process.env.CASEDEV_API_KEY = token;
	delete process.env.CORE_ACCESS_TOKEN;
}

async function readJsonSafe<T>(response: Response): Promise<T | null> {
	try {
		return (await response.json()) as T;
	} catch {
		return null;
	}
}

async function deviceFlowLoginCasedev(): Promise<string | null> {
	console.error(chalk.dim("  Starting device authorization...\n"));

	let startRes: Response;
	try {
		startRes = await fetch(`${CASEDEV_API_BASE}/auth/cli/start`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				scopes: { services: [{ service: "all", scopes: ["read", "write"] }] },
			}),
		});
	} catch {
		console.error(chalk.red("  Failed to reach case.dev. Check your internet connection."));
		return null;
	}

	if (!startRes.ok) {
		console.error(chalk.red(`  Failed to start device flow: ${startRes.status} ${startRes.statusText}`));
		return null;
	}

	const start = (await startRes.json()) as DeviceFlowStartResponse;
	const verifyUrl = start.verificationUriComplete;

	console.error(`  ${chalk.bold("Visit:")} ${clickableLink(verifyUrl, chalk.cyan.underline(verifyUrl))}\n`);

	// Try to open browser automatically
	openUrl(verifyUrl);

	console.error(chalk.dim("  Waiting for approval..."));

	const pollInterval = (start.interval || 3) * 1000;
	const expiresAt = new Date(start.expiresAt).getTime();

	while (Date.now() < expiresAt) {
		await new Promise((resolve) => setTimeout(resolve, pollInterval));

		try {
			const pollRes = await fetch(`${CASEDEV_API_BASE}/auth/cli/poll`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ deviceCode: start.deviceCode }),
			});

			if (pollRes.status === 429) {
				// Rate limited — wait longer
				await new Promise((resolve) => setTimeout(resolve, pollInterval));
				continue;
			}

			if (pollRes.status === 200) {
				const result = (await pollRes.json()) as DeviceFlowPollResponse;
				if (result.apiKey) {
					return result.apiKey;
				}
			}

			if (pollRes.status === 202) {
				// Still pending
				continue;
			}

			if (pollRes.status === 403 || pollRes.status === 410) {
				console.error(chalk.red("\n  Authorization denied or expired."));
				return null;
			}
		} catch {}
	}

	console.error(chalk.red("\n  Authorization timed out."));
	return null;
}

async function deviceFlowLoginCore(): Promise<string | null> {
	console.error(chalk.dim("  Starting Core device authorization...\n"));

	let startRes: Response;
	try {
		startRes = await fetch(`${CORE_API_BASE}/oauth/device/code`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				client_id: CORE_OAUTH_CLIENT_ID,
				scope: CORE_OAUTH_SCOPE,
			}),
		});
	} catch {
		console.error(chalk.red("  Failed to reach core.case.dev. Check your internet connection."));
		return null;
	}

	const start = await readJsonSafe<CoreDeviceCodeResponse>(startRes);
	if (!startRes.ok || !start?.device_code || !start.verification_uri_complete) {
		console.error(chalk.red(`  Failed to start Core device flow: ${startRes.status} ${startRes.statusText}`));
		return null;
	}

	const verifyUrl = start.verification_uri_complete;
	console.error(`  ${chalk.bold("Visit:")} ${clickableLink(verifyUrl, chalk.cyan.underline(verifyUrl))}\n`);

	openUrl(verifyUrl);
	console.error(chalk.dim("  Waiting for approval..."));

	let pollIntervalMs = Math.max(1, start.interval || 5) * 1000;
	const expiresAt = Date.now() + start.expires_in * 1000;

	while (Date.now() < expiresAt) {
		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

		let pollRes: Response;
		try {
			pollRes = await fetch(`${CORE_API_BASE}/oauth/token`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
					client_id: CORE_OAUTH_CLIENT_ID,
					device_code: start.device_code,
				}),
			});
		} catch {
			continue;
		}

		const result = await readJsonSafe<CoreTokenResponse>(pollRes);
		if (pollRes.ok && result?.access_token) {
			return result.access_token;
		}

		const errorCode = result?.error;
		if (!errorCode || errorCode === "authorization_pending") {
			continue;
		}
		if (errorCode === "slow_down") {
			pollIntervalMs += 1000;
			continue;
		}
		if (errorCode === "access_denied" || errorCode === "invalid_grant") {
			console.error(chalk.red("\n  Authorization denied or expired."));
			return null;
		}

		const description = result?.error_description ? `: ${result.error_description}` : "";
		console.error(chalk.red(`\n  Core OAuth error: ${errorCode}${description}`));
		return null;
	}

	console.error(chalk.red("\n  Authorization timed out."));
	return null;
}

async function manualTokenLogin(): Promise<string | null> {
	const key = await ask(chalk.bold("  API key or token: "));

	if (!key) {
		console.error(chalk.red("  No token provided."));
		return null;
	}

	// Verify token by listing models against the inferred endpoint.
	const llmBase = isCoreAccessToken(key) ? CORE_LLM_BASE : CASEDEV_LLM_BASE;
	console.error(chalk.dim("  Verifying..."));
	try {
		const res = await fetch(`${llmBase}/models`, {
			headers: { Authorization: `Bearer ${key}` },
		});
		if (!res.ok) {
			console.error(chalk.red(`  Token verification failed: ${res.status} ${res.statusText}`));
			return null;
		}
	} catch {
		console.error(chalk.red("  Failed to reach the model endpoint. Check your internet connection."));
		return null;
	}

	return key;
}

/** Path to casedev CLI config */
const CASEDEV_CONFIG_PATH = join(homedir(), ".config", "case", "config.json");

function saveKey(apiKey: string): void {
	// Save to linc auth storage (~/.linc/agent/auth.json)
	const authStorage = AuthStorage.create();
	const providerId = isCoreAccessToken(apiKey) ? CASEMARK_CORE_PROVIDER_ID : CASEDEV_PROVIDER_ID;
	authStorage.set(providerId, { type: "api_key", key: apiKey });

	// Only case.dev sk_case_* keys should be mirrored to casedev CLI config.
	if (!apiKey.startsWith("sk_case_")) {
		return;
	}

	// Also save to casedev CLI config (~/.config/case/config.json) so both CLIs share the key.
	try {
		const dir = dirname(CASEDEV_CONFIG_PATH);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		}
		let config: Record<string, any> = {};
		if (existsSync(CASEDEV_CONFIG_PATH)) {
			config = JSON.parse(readFileSync(CASEDEV_CONFIG_PATH, "utf-8"));
		}
		config.apiKey = apiKey;
		writeFileSync(CASEDEV_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
		chmodSync(CASEDEV_CONFIG_PATH, 0o600);
	} catch {
		// Non-fatal — linc auth.json is the primary store
	}
}

function readCasedevCliKey(): string | undefined {
	try {
		if (existsSync(CASEDEV_CONFIG_PATH)) {
			const config = JSON.parse(readFileSync(CASEDEV_CONFIG_PATH, "utf-8"));
			if (config.apiKey && typeof config.apiKey === "string") {
				return config.apiKey;
			}
		}
	} catch {
		// ignore
	}
	return undefined;
}

export async function runLogin(): Promise<boolean> {
	console.error("");
	console.error(chalk.bold("  linc login"));
	console.error("");

	const choice = await ask(
		`  ${chalk.bold("1)")} Browser login (Core OAuth tokens)\n  ${chalk.bold("2)")} Browser login (case.dev API key)\n  ${chalk.bold("3)")} Paste API key or token\n\n  Choice [1]: `,
	);

	const target: LoginTarget = choice === "2" ? "casedev" : choice === "3" ? "manual" : "core";

	console.error("");

	let apiKey: string | null = null;

	if (target === "core") {
		apiKey = await deviceFlowLoginCore();
	} else if (target === "casedev") {
		apiKey = await deviceFlowLoginCasedev();
	} else {
		apiKey = await manualTokenLogin();
	}

	if (!apiKey) {
		return false;
	}

	saveKey(apiKey);

	// Also set token in current process for model loading.
	setProcessAuthToken(apiKey);

	console.error(chalk.green("\n  Authenticated! Token saved to ~/.linc/agent/auth.json\n"));
	return true;
}

/**
 * Check if the user is authenticated. Returns true if a valid API token is available.
 */
export function isAuthenticated(): boolean {
	// 1. Check CORE_ACCESS_TOKEN env var (Core OAuth convention)
	if (process.env.CORE_ACCESS_TOKEN) {
		return true;
	}

	// 2. Check CASEDEV_API_KEY env var (linc convention)
	if (process.env.CASEDEV_API_KEY) {
		return true;
	}

	// 3. Check CASE_API_KEY env var (casedev CLI convention)
	if (process.env.CASE_API_KEY) {
		process.env.CASEDEV_API_KEY = process.env.CASE_API_KEY;
		return true;
	}

	// 4. Check linc auth.json (~/.linc/agent/auth.json)
	try {
		const authStorage = AuthStorage.create();
		for (const providerId of [CASEMARK_CORE_PROVIDER_ID, CASEDEV_PROVIDER_ID]) {
			const cred = authStorage.get(providerId);
			if (cred?.type === "api_key" && cred.key) {
				setProcessAuthToken(cred.key);
				return true;
			}
			if (cred?.type === "oauth" && cred.access) {
				setProcessAuthToken(cred.access);
				return true;
			}
		}
	} catch {
		// auth.json doesn't exist or is corrupt
	}

	// 5. Check casedev CLI config (~/.config/case/config.json)
	const casedevKey = readCasedevCliKey();
	if (casedevKey) {
		process.env.CASEDEV_API_KEY = casedevKey;
		return true;
	}

	return false;
}

/**
 * Ensure the user is authenticated. If not, run the login flow.
 * Returns true if authenticated (either already or after login).
 */
export async function ensureAuthenticated(): Promise<boolean> {
	if (isAuthenticated()) {
		return true;
	}

	console.error(chalk.yellow("\n  No auth token found. Let's get you set up.\n"));
	return runLogin();
}
