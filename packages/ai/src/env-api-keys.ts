const DEFAULT_CASEDEV_LLM_BASE_URL = "https://api.case.dev/llm/v1";
const DEFAULT_CORE_LLM_BASE_URL = "https://core.case.dev/v1";

function trimTrailingSlash(url: string): string {
	return url.replace(/\/+$/, "");
}

function isCoreAccessToken(token: string | undefined): boolean {
	return !!token && token.startsWith("core_at_");
}

/**
 * Get API key / bearer token for the unified LLM endpoint.
 * Priority:
 * 1. CORE_ACCESS_TOKEN (Core OAuth flow)
 * 2. CASEDEV_API_KEY (linc convention)
 * 3. CASE_API_KEY (casedev CLI convention)
 */
export function getEnvApiKey(_provider?: string): string | undefined {
	return process.env.CORE_ACCESS_TOKEN || process.env.CASEDEV_API_KEY || process.env.CASE_API_KEY;
}

/**
 * Resolve LLM base URL from env + token type.
 * - LINC_LLM_BASE_URL overrides everything.
 * - CORE_API_BASE_URL / CASEDEV_API_BASE_URL allow explicit endpoint pinning.
 * - Otherwise infer from token prefix.
 */
export function getEnvLlmBaseUrl(apiKey?: string): string {
	if (process.env.LINC_LLM_BASE_URL) {
		return trimTrailingSlash(process.env.LINC_LLM_BASE_URL);
	}

	const resolvedApiKey = apiKey || getEnvApiKey();
	if (process.env.CORE_API_BASE_URL && isCoreAccessToken(resolvedApiKey)) {
		return trimTrailingSlash(process.env.CORE_API_BASE_URL);
	}
	if (process.env.CASEDEV_API_BASE_URL && resolvedApiKey && !isCoreAccessToken(resolvedApiKey)) {
		return trimTrailingSlash(process.env.CASEDEV_API_BASE_URL);
	}

	if (isCoreAccessToken(resolvedApiKey) || !!process.env.CORE_ACCESS_TOKEN) {
		return DEFAULT_CORE_LLM_BASE_URL;
	}
	return DEFAULT_CASEDEV_LLM_BASE_URL;
}
