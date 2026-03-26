import { clearApiProviders, registerApiProvider } from "../api-registry.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";

let openAICompletionsProviderModulePromise:
	| Promise<{
			stream: (model: any, context: any, options?: any) => any;
			streamSimple: (model: any, context: any, options?: any) => any;
	  }>
	| undefined;

function loadOpenAICompletionsProviderModule() {
	openAICompletionsProviderModulePromise ||= import("./openai-completions.js").then((module) => ({
		stream: module.streamOpenAICompletions,
		streamSimple: module.streamSimpleOpenAICompletions,
	}));
	return openAICompletionsProviderModulePromise;
}

// biome-ignore lint/complexity/noBannedTypes: The lazy loader preserves the provider module's existing untyped runtime boundary.
function createLazyStream(loadModule: () => Promise<{ stream: Function }>) {
	return (model: any, context: any, options?: any) => {
		const outer = new AssistantMessageEventStream();
		loadModule()
			.then((module) => {
				const inner = module.stream(model, context, options);
				(async () => {
					for await (const event of inner) {
						outer.push(event);
					}
					outer.end();
				})();
			})
			.catch((error) => {
				outer.push({
					type: "error",
					reason: "error",
					error: {
						role: "assistant",
						content: [],
						api: model.api,
						provider: model.provider,
						model: model.id,
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 0,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						},
						stopReason: "error",
						errorMessage: error instanceof Error ? error.message : String(error),
						timestamp: Date.now(),
					},
				});
				outer.end();
			});
		return outer;
	};
}

// biome-ignore lint/complexity/noBannedTypes: The lazy loader preserves the provider module's existing untyped runtime boundary.
function createLazySimpleStream(loadModule: () => Promise<{ streamSimple: Function }>) {
	return (model: any, context: any, options?: any) => {
		const outer = new AssistantMessageEventStream();
		loadModule()
			.then((module) => {
				const inner = module.streamSimple(model, context, options);
				(async () => {
					for await (const event of inner) {
						outer.push(event);
					}
					outer.end();
				})();
			})
			.catch((error) => {
				outer.push({
					type: "error",
					reason: "error",
					error: {
						role: "assistant",
						content: [],
						api: model.api,
						provider: model.provider,
						model: model.id,
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 0,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						},
						stopReason: "error",
						errorMessage: error instanceof Error ? error.message : String(error),
						timestamp: Date.now(),
					},
				});
				outer.end();
			});
		return outer;
	};
}

export const streamOpenAICompletions = createLazyStream(loadOpenAICompletionsProviderModule);
export const streamSimpleOpenAICompletions = createLazySimpleStream(loadOpenAICompletionsProviderModule);

export function registerBuiltInApiProviders(): void {
	registerApiProvider({
		api: "openai-completions",
		stream: streamOpenAICompletions as any,
		streamSimple: streamSimpleOpenAICompletions as any,
	});
}

export function resetApiProviders(): void {
	clearApiProviders();
	registerBuiltInApiProviders();
}

registerBuiltInApiProviders();
