/**
 * Catalog prices are USD per million tokens.
 *
 * Every source feed publishes at most seven significant digits. models.dev
 * prices are already per million tokens; OpenRouter and the Vercel AI Gateway
 * publish per-token decimal strings that are multiplied by 1,000,000 here.
 * Both paths can carry binary-float noise (0.21559999999999999,
 * 3.9600000000000004, 0.049999999999999996) into the generated catalog, where
 * it churns diffs without changing what anyone is billed.
 *
 * Rounding to eight decimal places (1e-8 USD per million tokens, 1e-14 USD per
 * token) sits below every published price step and above the noise, so the
 * serialized value is the source figure and consecutive runs are byte-identical.
 *
 * Known exception: OpenRouter derives Gemini cache-write prices from a
 * repeating decimal (0.0000000416666666666667 per token, i.e. 1/24 USD per
 * million tokens). No finite source figure exists, so it serializes as
 * 0.04166667.
 */
export const CATALOG_PRICE_DECIMALS = 8;

export interface CatalogCost {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

/**
 * Round a USD-per-million-tokens price to catalog precision. Non-finite input is
 * treated as free, matching how the generators have always read missing prices.
 */
export function roundCatalogPrice(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Number(value.toFixed(CATALOG_PRICE_DECIMALS));
}

/**
 * Convert a feed's per-token price (string or number) to rounded USD per million
 * tokens. An absent price means the feed does not bill that dimension and is
 * free; a present but unparseable price is a feed defect, so it is logged and
 * treated as free rather than silently accepted.
 */
export function perMillionTokens(perToken: string | number | undefined): number {
	if (perToken === undefined || perToken === "") return 0;
	const parsed = typeof perToken === "number" ? perToken : Number.parseFloat(perToken);
	if (!Number.isFinite(parsed)) {
		console.warn(`Unparseable per-token price ${JSON.stringify(perToken)}; treating it as 0`);
		return 0;
	}
	return roundCatalogPrice(parsed * 1_000_000);
}

export function roundCatalogCost<T extends CatalogCost>(cost: T): T {
	return {
		...cost,
		input: roundCatalogPrice(cost.input),
		output: roundCatalogPrice(cost.output),
		cacheRead: roundCatalogPrice(cost.cacheRead),
		cacheWrite: roundCatalogPrice(cost.cacheWrite),
	};
}
