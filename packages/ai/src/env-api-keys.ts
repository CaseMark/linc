/**
 * Get API key for case.dev LLM endpoint.
 * All providers route through case.dev, so there's only one key.
 * Checks both CASEDEV_API_KEY (linc) and CASE_API_KEY (casedev CLI).
 */
export function getEnvApiKey(_provider?: string): string | undefined {
	return process.env.CASEDEV_API_KEY || process.env.CASE_API_KEY;
}
