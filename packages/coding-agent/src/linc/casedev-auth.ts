import type { OAuthDeviceCodeInfo } from "@earendil-works/pi-ai/oauth";

export const CASEDEV_PROVIDER_ID = "casedev";
export const CASEMARK_CORE_PROVIDER_ID = "casemark-core";
export const CASEDEV_PROVIDER_NAME = "Case.dev";
export const CASEMARK_CORE_PROVIDER_NAME = "Casemark Core";

export const CASEDEV_AUTH_PROVIDER_IDS = [CASEDEV_PROVIDER_ID, CASEMARK_CORE_PROVIDER_ID] as const;

type CaseDevDeviceStartResponse = {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete?: string;
	interval?: number;
	expiresIn?: number;
};

type CaseDevDevicePollResponse = {
	error?: string;
	interval?: number;
	apiKey?: string;
	tokenType?: string;
};

type CaseDevAuthCallbacks = {
	onDeviceCode: (info: OAuthDeviceCodeInfo) => void;
	onProgress: (message: string) => void;
	signal?: AbortSignal;
};

function getCaseDevApiBaseUrl(): string {
	return (process.env.CASEDEV_API_BASE_URL || process.env.CASE_API_URL || "https://api.case.dev").replace(/\/$/, "");
}

async function readJsonResponse<T>(response: Response): Promise<T> {
	const text = await response.text();
	if (!text) return {} as T;
	return JSON.parse(text) as T;
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<{ response: Response; data: T }> {
	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
		signal,
	});
	const data = await readJsonResponse<T>(response);
	return { response, data };
}

function getPollDelayMs(
	response: CaseDevDeviceStartResponse | CaseDevDevicePollResponse,
	fallbackSeconds: number,
): number {
	const interval =
		typeof response.interval === "number" && response.interval > 0 ? response.interval : fallbackSeconds;
	return interval * 1000;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Login cancelled"));
			return;
		}

		const timeout = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timeout);
			reject(new Error("Login cancelled"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export async function loginCaseDevApiKey(callbacks: CaseDevAuthCallbacks): Promise<string> {
	const baseUrl = getCaseDevApiBaseUrl();
	const start = await postJson<CaseDevDeviceStartResponse>(
		`${baseUrl}/auth/cli/start`,
		{ requestedScopes: { services: [{ service: "all", scopes: ["read", "write"] }] } },
		callbacks.signal,
	);

	if (!start.response.ok) {
		throw new Error(`Case.dev login failed to start: HTTP ${start.response.status}`);
	}

	if (!start.data.deviceCode || !start.data.userCode || !start.data.verificationUri) {
		throw new Error("Case.dev login returned an invalid device authorization response.");
	}

	callbacks.onDeviceCode({
		userCode: start.data.userCode,
		verificationUri: start.data.verificationUriComplete || start.data.verificationUri,
		intervalSeconds: start.data.interval,
		expiresInSeconds: start.data.expiresIn,
	});
	callbacks.onProgress("Waiting for Case.dev authorization...");

	let delayMs = getPollDelayMs(start.data, 5);
	for (;;) {
		await sleep(delayMs, callbacks.signal);

		const poll = await postJson<CaseDevDevicePollResponse>(
			`${baseUrl}/auth/cli/poll`,
			{ deviceCode: start.data.deviceCode },
			callbacks.signal,
		);

		if (poll.response.status === 202 && poll.data.error === "authorization_pending") {
			delayMs = getPollDelayMs(poll.data, 5);
			continue;
		}

		if (poll.response.status === 429 && poll.data.error === "slow_down") {
			delayMs = getPollDelayMs(poll.data, Math.ceil(delayMs / 1000) + 1);
			continue;
		}

		if (!poll.response.ok) {
			throw new Error(poll.data.error || `Case.dev login failed: HTTP ${poll.response.status}`);
		}

		if (poll.data.tokenType !== "api_key" || !poll.data.apiKey) {
			throw new Error("Case.dev login completed without an API key.");
		}

		return poll.data.apiKey;
	}
}
