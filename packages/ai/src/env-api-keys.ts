/**
 * Get API key for case.dev LLM endpoint.
 * All providers route through case.dev, so there's only one key.
 */
export function getEnvApiKey(_provider?: string): string | undefined {
	return process.env.CASEDEV_API_KEY;
}
