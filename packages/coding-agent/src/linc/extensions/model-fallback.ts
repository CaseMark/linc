import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionContext, ExtensionFactory } from "../../core/extensions/types.ts";
import {
	getActiveModelFallback,
	getFallbackChain,
	getFallbackTtlMs,
	getNextFallbackModelId,
	isFallbackStatus,
	LINC_MODEL_FALLBACK_ENTRY_TYPE,
	resolveFallbackModel,
} from "../model-fallback.ts";

const modelFallbackExtension: ExtensionFactory = (pi) => {
	let applying = false;

	const applyModel = async (model: Model<string>): Promise<boolean> => {
		applying = true;
		try {
			return await pi.setModel(model);
		} finally {
			applying = false;
		}
	};

	const restoreIfDue = async (ctx: ExtensionContext): Promise<void> => {
		const state = getActiveModelFallback(ctx.sessionManager);
		if (!state || state.restored || state.cancelled || Date.now() < state.restoreAt) return;
		const original = ctx.modelRegistry.find(state.originalProvider, state.originalModelId);
		if (!original) return;
		if (ctx.model?.provider === original.provider && ctx.model.id === original.id) {
			pi.appendEntry(LINC_MODEL_FALLBACK_ENTRY_TYPE, { ...state, restored: true });
			ctx.ui.setStatus("linc.model-fallback", undefined);
			return;
		}
		const switched = await applyModel(original);
		if (!switched) return;
		pi.appendEntry(LINC_MODEL_FALLBACK_ENTRY_TYPE, { ...state, restored: true });
		ctx.ui.setStatus("linc.model-fallback", undefined);
		ctx.ui.notify(`Restored ${original.provider}/${original.id} after fallback window`, "info");
	};

	pi.on("after_provider_response", async (event, ctx) => {
		if (!isFallbackStatus(event.status)) return;
		const current = ctx.model;
		if (!current) return;

		const nextModelId = getNextFallbackModelId(current.id, getFallbackChain());
		if (!nextModelId) return;

		// Already switched to this target (e.g. a second in-flight request from
		// the same failing model): don't re-append state or re-notify. A failure
		// from the fallback model itself has a different `current`, so the chain
		// still advances.
		const active = getActiveModelFallback(ctx.sessionManager);
		const activeInWindow = active && !active.restored && !active.cancelled && Date.now() < active.restoreAt;
		if (activeInWindow && active.fallbackModelId.toLowerCase() === nextModelId) return;

		const fallback = resolveFallbackModel(ctx.modelRegistry, current.provider, nextModelId);
		if (!fallback || (fallback.provider === current.provider && fallback.id === current.id)) return;

		const switched = await applyModel(fallback);
		if (!switched) return;

		// Keep the user's original model across chain hops so the restore always
		// returns to what they picked, not to an intermediate fallback.
		const original = activeInWindow
			? { provider: active.originalProvider, id: active.originalModelId }
			: { provider: current.provider, id: current.id };
		pi.appendEntry(LINC_MODEL_FALLBACK_ENTRY_TYPE, {
			originalProvider: original.provider,
			originalModelId: original.id,
			fallbackProvider: fallback.provider,
			fallbackModelId: fallback.id,
			restoreAt: Date.now() + getFallbackTtlMs(),
		});
		ctx.ui.setStatus("linc.model-fallback", `fallback: ${fallback.id}`);
		ctx.ui.notify(
			`${current.provider}/${current.id} is having trouble (HTTP ${event.status}); temporarily using ${fallback.provider}/${fallback.id} for ${Math.round(getFallbackTtlMs() / 60000)}m`,
			"warning",
		);
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		await restoreIfDue(ctx);
	});

	pi.on("session_start", async (_event, ctx) => {
		await restoreIfDue(ctx);
	});

	pi.on("model_select", async (event, ctx) => {
		if (applying) return;
		const state = getActiveModelFallback(ctx.sessionManager);
		if (!state || state.restored || state.cancelled) return;
		if (event.model.provider === state.fallbackProvider && event.model.id === state.fallbackModelId) return;
		pi.appendEntry(LINC_MODEL_FALLBACK_ENTRY_TYPE, { ...state, cancelled: true });
		ctx.ui.setStatus("linc.model-fallback", undefined);
	});
};

export default modelFallbackExtension;
