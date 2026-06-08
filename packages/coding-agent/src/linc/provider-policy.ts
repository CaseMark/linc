const BLOCKED_LOGIN_PROVIDER_IDS = new Set([
	"ant-ling",
	"deepseek",
	"kimi-coding",
	"minimax",
	"minimax-cn",
	"moonshotai",
	"moonshotai-cn",
	"xiaomi",
	"xiaomi-token-plan-ams",
	"xiaomi-token-plan-cn",
	"xiaomi-token-plan-sgp",
	"zai",
	"zai-coding-cn",
]);

export function isLincBlockedLoginProvider(providerName: string): boolean {
	return BLOCKED_LOGIN_PROVIDER_IDS.has(providerName.toLowerCase());
}
