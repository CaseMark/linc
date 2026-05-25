import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "./types.js";

const env = typeof process === "undefined" ? undefined : process.env;
const CORE_API_BASE = env?.CORE_API_BASE_URL || "https://core.case.dev";
const CORE_OAUTH_CLIENT_ID = env?.LINC_CORE_OAUTH_CLIENT_ID || "linc";
const CORE_OAUTH_SCOPE = env?.LINC_CORE_OAUTH_SCOPE || "core:chat";

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

async function readJsonSafe<T>(response: Response): Promise<T | null> {
	try {
		return (await response.json()) as T;
	} catch {
		return null;
	}
}

function toCredentials(result: CoreTokenResponse): OAuthCredentials {
	if (!result.access_token) {
		throw new Error("Core OAuth response did not include an access token");
	}

	return {
		refresh: result.refresh_token || "",
		access: result.access_token,
		expires: Date.now() + Math.max(1, result.expires_in || 3600) * 1000,
		scope: result.scope,
		tokenType: result.token_type,
	};
}

export async function loginCasemarkCore(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	callbacks.onProgress?.("Starting CaseMark Core device authorization...");

	const startRes = await fetch(`${CORE_API_BASE}/oauth/device/code`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			client_id: CORE_OAUTH_CLIENT_ID,
			scope: CORE_OAUTH_SCOPE,
		}),
		signal: callbacks.signal,
	});

	const start = await readJsonSafe<CoreDeviceCodeResponse>(startRes);
	if (!startRes.ok || !start?.device_code || !start.verification_uri_complete) {
		throw new Error(`Failed to start Core device flow: ${startRes.status} ${startRes.statusText}`);
	}

	callbacks.onAuth({
		url: start.verification_uri_complete,
		instructions: `Approve the code ${start.user_code}.`,
	});
	callbacks.onProgress?.("Waiting for approval...");

	let pollIntervalMs = Math.max(1, start.interval || 5) * 1000;
	const expiresAt = Date.now() + start.expires_in * 1000;

	while (Date.now() < expiresAt) {
		if (callbacks.signal?.aborted) {
			throw new Error("Login cancelled");
		}

		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

		const pollRes = await fetch(`${CORE_API_BASE}/oauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				client_id: CORE_OAUTH_CLIENT_ID,
				device_code: start.device_code,
			}),
			signal: callbacks.signal,
		});

		const result = await readJsonSafe<CoreTokenResponse>(pollRes);
		if (pollRes.ok && result?.access_token) {
			return toCredentials(result);
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
			throw new Error("Core authorization denied or expired");
		}

		const description = result?.error_description ? `: ${result.error_description}` : "";
		throw new Error(`Core OAuth error: ${errorCode}${description}`);
	}

	throw new Error("Core authorization timed out");
}

export async function refreshCasemarkCoreToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
	if (!credentials.refresh) {
		throw new Error("Core OAuth credentials do not include a refresh token");
	}

	const res = await fetch(`${CORE_API_BASE}/oauth/token`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			grant_type: "refresh_token",
			client_id: CORE_OAUTH_CLIENT_ID,
			refresh_token: credentials.refresh,
		}),
	});

	const result = await readJsonSafe<CoreTokenResponse>(res);
	if (!res.ok || !result?.access_token) {
		throw new Error(`Failed to refresh Core OAuth token: ${res.status} ${res.statusText}`);
	}

	return {
		...credentials,
		...toCredentials(result),
		refresh: result.refresh_token || credentials.refresh,
	};
}

export const casemarkCoreOAuthProvider: OAuthProviderInterface = {
	id: "casemark-core",
	name: "CaseMark Core",
	login: loginCasemarkCore,
	refreshToken: refreshCasemarkCoreToken,
	getApiKey(credentials) {
		return credentials.access;
	},
};
