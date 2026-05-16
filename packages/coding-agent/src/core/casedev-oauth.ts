/**
 * OAuth providers for case.dev and Core device-flow authentication.
 * These register into the OAuth provider registry so they appear in /login.
 */

import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "@casemark/linc-ai";

const CASEDEV_API_BASE = process.env.CASEDEV_API_BASE_URL || "https://api.case.dev";
const CORE_API_BASE = process.env.CORE_API_BASE_URL || "https://core.case.dev";
const CORE_OAUTH_CLIENT_ID = process.env.LINC_CORE_OAUTH_CLIENT_ID || "linc";
const CORE_OAUTH_SCOPE = process.env.LINC_CORE_OAUTH_SCOPE || "core:chat";

const FAR_FUTURE = Date.now() + 365 * 24 * 60 * 60 * 1000;

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

export const casedevOAuthProvider: OAuthProviderInterface = {
	id: "casedev",
	name: "case.dev",

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		callbacks.onProgress?.("Starting device authorization...");

		const startRes = await fetch(`${CASEDEV_API_BASE}/auth/cli/start`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				scopes: { services: [{ service: "all", scopes: ["read", "write"] }] },
			}),
			signal: callbacks.signal,
		});

		if (!startRes.ok) {
			throw new Error(`Failed to start device flow: ${startRes.status} ${startRes.statusText}`);
		}

		const start = (await startRes.json()) as DeviceFlowStartResponse;
		callbacks.onAuth({ url: start.verificationUriComplete });
		callbacks.onProgress?.("Waiting for approval...");

		const pollInterval = (start.interval || 3) * 1000;
		const expiresAt = new Date(start.expiresAt).getTime();

		while (Date.now() < expiresAt) {
			callbacks.signal?.throwIfAborted();
			await new Promise((resolve) => setTimeout(resolve, pollInterval));

			const pollRes = await fetch(`${CASEDEV_API_BASE}/auth/cli/poll`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ deviceCode: start.deviceCode }),
				signal: callbacks.signal,
			});

			if (pollRes.status === 200) {
				const result = (await pollRes.json()) as DeviceFlowPollResponse;
				if (result.apiKey) {
					return { access: result.apiKey, refresh: "", expires: FAR_FUTURE };
				}
			}

			if (pollRes.status === 429 || pollRes.status === 202) {
				continue;
			}

			if (pollRes.status === 403 || pollRes.status === 410) {
				throw new Error("Authorization denied or expired.");
			}
		}

		throw new Error("Authorization timed out.");
	},

	async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
		return credentials;
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},
};

export const coreOAuthProvider: OAuthProviderInterface = {
	id: "core",
	name: "Core",

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		callbacks.onProgress?.("Starting Core device authorization...");

		const startRes = await fetch(`${CORE_API_BASE}/oauth/device/code`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				client_id: CORE_OAUTH_CLIENT_ID,
				scope: CORE_OAUTH_SCOPE,
			}),
			signal: callbacks.signal,
		});

		if (!startRes.ok) {
			throw new Error(`Failed to start Core device flow: ${startRes.status} ${startRes.statusText}`);
		}

		const start = (await startRes.json()) as CoreDeviceCodeResponse;
		if (!start.device_code || !start.verification_uri_complete) {
			throw new Error("Invalid device code response from Core.");
		}

		callbacks.onAuth({ url: start.verification_uri_complete });
		callbacks.onProgress?.("Waiting for approval...");

		let pollIntervalMs = Math.max(1, start.interval || 5) * 1000;
		const expiresAt = Date.now() + start.expires_in * 1000;

		while (Date.now() < expiresAt) {
			callbacks.signal?.throwIfAborted();
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
					signal: callbacks.signal,
				});
			} catch {
				continue;
			}

			const result = (await pollRes.json()) as CoreTokenResponse;

			if (pollRes.ok && result.access_token) {
				const expiresIn = result.expires_in ?? 3600;
				return {
					access: result.access_token,
					refresh: result.refresh_token ?? "",
					expires: Date.now() + expiresIn * 1000,
				};
			}

			const errorCode = result.error;
			if (!errorCode || errorCode === "authorization_pending") {
				continue;
			}
			if (errorCode === "slow_down") {
				pollIntervalMs += 1000;
				continue;
			}
			if (errorCode === "access_denied" || errorCode === "invalid_grant") {
				throw new Error("Authorization denied or expired.");
			}

			const description = result.error_description ? `: ${result.error_description}` : "";
			throw new Error(`Core OAuth error: ${errorCode}${description}`);
		}

		throw new Error("Authorization timed out.");
	},

	async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
		if (!credentials.refresh) {
			return credentials;
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

		const result = (await res.json()) as CoreTokenResponse;
		if (!res.ok || !result.access_token) {
			throw new Error(result.error_description || result.error || "Token refresh failed");
		}

		const expiresIn = result.expires_in ?? 3600;
		return {
			access: result.access_token,
			refresh: result.refresh_token ?? credentials.refresh,
			expires: Date.now() + expiresIn * 1000,
		};
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},
};
