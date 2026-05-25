import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "./types.js";

const env = typeof process === "undefined" ? undefined : process.env;
const CASEDEV_API_BASE = env?.CASEDEV_API_BASE_URL || "https://api.case.dev";
const NEVER_EXPIRES = 253402300799000;

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

export async function loginCasedev(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	callbacks.onProgress?.("Starting case.dev device authorization...");

	const startRes = await fetch(`${CASEDEV_API_BASE}/auth/cli/start`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			scopes: { services: [{ service: "all", scopes: ["read", "write"] }] },
		}),
		signal: callbacks.signal,
	});

	if (!startRes.ok) {
		throw new Error(`Failed to start case.dev device flow: ${startRes.status} ${startRes.statusText}`);
	}

	const start = (await startRes.json()) as DeviceFlowStartResponse;
	callbacks.onAuth({
		url: start.verificationUriComplete,
		instructions: `Approve the code ${start.userCode}.`,
	});
	callbacks.onProgress?.("Waiting for approval...");

	const pollInterval = (start.interval || 3) * 1000;
	const expiresAt = new Date(start.expiresAt).getTime();

	while (Date.now() < expiresAt) {
		if (callbacks.signal?.aborted) {
			throw new Error("Login cancelled");
		}

		await new Promise((resolve) => setTimeout(resolve, pollInterval));

		const pollRes = await fetch(`${CASEDEV_API_BASE}/auth/cli/poll`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ deviceCode: start.deviceCode }),
			signal: callbacks.signal,
		});

		if (pollRes.status === 429 || pollRes.status === 202) {
			continue;
		}

		if (pollRes.status === 200) {
			const result = (await pollRes.json()) as DeviceFlowPollResponse;
			if (result.apiKey) {
				return {
					refresh: "",
					access: result.apiKey,
					expires: NEVER_EXPIRES,
				};
			}
		}

		if (pollRes.status === 403 || pollRes.status === 410) {
			throw new Error("case.dev authorization denied or expired");
		}
	}

	throw new Error("case.dev authorization timed out");
}

export const casedevOAuthProvider: OAuthProviderInterface = {
	id: "casedev",
	name: "case.dev",
	login: loginCasedev,
	async refreshToken(credentials) {
		return credentials;
	},
	getApiKey(credentials) {
		return credentials.access;
	},
};
