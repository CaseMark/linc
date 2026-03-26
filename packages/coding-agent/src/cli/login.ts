/**
 * linc login — authenticate with case.dev
 *
 * Supports two flows:
 * 1. Device flow: opens browser → user approves → API key issued
 * 2. API key paste: user pastes an existing sk_case_* key
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import chalk from "chalk";
import { createInterface } from "readline";
import { getAgentDir } from "../config.js";
import { AuthStorage } from "../core/auth-storage.js";

const CASEDEV_API_BASE = "https://api.case.dev";
const CASEDEV_CONSOLE_URL = "https://console.case.dev";

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

async function deviceFlowLogin(): Promise<string | null> {
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
	} catch (error) {
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
		} catch {
			// Network error, retry
			continue;
		}
	}

	console.error(chalk.red("\n  Authorization timed out."));
	return null;
}

async function apiKeyLogin(): Promise<string | null> {
	const key = await ask(chalk.bold("  API key: "));

	if (!key) {
		console.error(chalk.red("  No key provided."));
		return null;
	}

	if (!key.startsWith("sk_case_")) {
		console.error(chalk.red("  Invalid key format. case.dev API keys start with sk_case_"));
		return null;
	}

	// Verify the key works
	console.error(chalk.dim("  Verifying..."));
	try {
		const res = await fetch(`${CASEDEV_API_BASE}/llm/v1/models`, {
			headers: { Authorization: `Bearer ${key}` },
		});
		if (!res.ok) {
			console.error(chalk.red(`  Key verification failed: ${res.status} ${res.statusText}`));
			return null;
		}
	} catch {
		console.error(chalk.red("  Failed to reach case.dev. Check your internet connection."));
		return null;
	}

	return key;
}

/** Path to casedev CLI config */
const CASEDEV_CONFIG_PATH = join(homedir(), ".config", "case", "config.json");

function saveKey(apiKey: string): void {
	// Save to linc auth storage (~/.linc/agent/auth.json)
	const authStorage = AuthStorage.create();
	authStorage.set("casedev", { type: "api_key", key: apiKey });

	// Also save to casedev CLI config (~/.config/case/config.json) so both CLIs share the key
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

	const choice = await ask(`  ${chalk.bold("1)")} Browser login (opens case.dev)\n  ${chalk.bold("2)")} Paste API key\n\n  Choice [1]: `);

	const useDeviceFlow = choice !== "2";

	console.error("");

	let apiKey: string | null;

	if (useDeviceFlow) {
		apiKey = await deviceFlowLogin();
	} else {
		apiKey = await apiKeyLogin();
	}

	if (!apiKey) {
		return false;
	}

	saveKey(apiKey);

	// Also set it in the current process so loadModels() works
	process.env.CASEDEV_API_KEY = apiKey;

	console.error(chalk.green("\n  Authenticated! Key saved to ~/.linc/agent/auth.json\n"));
	return true;
}

/**
 * Check if the user is authenticated. Returns true if a valid API key is available.
 */
export function isAuthenticated(): boolean {
	// 1. Check CASEDEV_API_KEY env var (linc convention)
	if (process.env.CASEDEV_API_KEY) {
		return true;
	}

	// 2. Check CASE_API_KEY env var (casedev CLI convention)
	if (process.env.CASE_API_KEY) {
		process.env.CASEDEV_API_KEY = process.env.CASE_API_KEY;
		return true;
	}

	// 3. Check linc auth.json (~/.linc/agent/auth.json)
	try {
		const authStorage = AuthStorage.create();
		const cred = authStorage.get("casedev");
		if (cred?.type === "api_key" && cred.key) {
			process.env.CASEDEV_API_KEY = cred.key;
			return true;
		}
	} catch {
		// auth.json doesn't exist or is corrupt
	}

	// 4. Check casedev CLI config (~/.config/case/config.json)
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

	console.error(chalk.yellow("\n  No case.dev API key found. Let's get you set up.\n"));
	return runLogin();
}
