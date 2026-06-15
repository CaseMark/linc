import type { ExtensionFactory } from "../../core/extensions/types.ts";
import { buildMatterMdSystemPrompt, readMatterMd, syncMatterMdToolResult } from "../matter-md.ts";
import { createMatterMdTools } from "../matter-md-tools.ts";
import { getAttachedVault } from "../vault-attachment.ts";
import {
	buildMatterAutoInitPrompt,
	buildMatterInitPrompt,
	editMatterMd,
	ensureMatterMd,
	showMatterMd,
	syncMatterMd,
} from "./matter-session.ts";

const matterExtension: ExtensionFactory = (pi) => {
	for (const tool of createMatterMdTools()) {
		pi.registerTool(tool);
	}

	pi.on("session_start", async (_event, ctx) => {
		const vault = getAttachedVault(ctx.sessionManager);
		if (!vault) return;
		await ensureMatterMd(pi, ctx, {
			sourcePrecedence: "vault-first",
			promptForMissing: true,
		});
	});

	pi.on("session_compact", async (_event, ctx) => {
		if (!getAttachedVault(ctx.sessionManager)) return;
		await ensureMatterMd(pi, ctx, { promptForMissing: false });
	});

	pi.on("resources_discover", async (_event, ctx) => {
		if (!getAttachedVault(ctx.sessionManager)) return undefined;
		const matter = await readMatterMd(ctx);
		return matter ? { contextFilePaths: [matter.path] } : undefined;
	});

	pi.on("tool_result", async (event, ctx) => {
		return syncMatterMdToolResult(ctx, event);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!getAttachedVault(ctx.sessionManager)) return undefined;
		const matter = await readMatterMd(ctx);
		if (!matter) return undefined;
		return {
			systemPrompt: [event.systemPrompt, buildMatterMdSystemPrompt(matter)].join("\n\n"),
		};
	});

	pi.registerCommand("matter", {
		description: "Show, edit, or sync the active MATTER.md",
		async handler(args, ctx) {
			const trimmed = args.trim();
			if (trimmed === "" || trimmed === "show") {
				await showMatterMd(ctx);
				return;
			}

			if (trimmed === "edit") {
				await editMatterMd(pi, ctx);
				return;
			}

			if (trimmed === "sync") {
				await syncMatterMd(ctx);
				return;
			}

			throw new Error("Usage: /matter, /matter edit, or /matter sync");
		},
		getArgumentCompletions(argumentPrefix) {
			const prefix = argumentPrefix.trim();
			return ["show", "edit", "sync"]
				.filter((value) => value.startsWith(prefix))
				.map((value) => ({ label: value, value }));
		},
	});

	pi.registerCommand("init", {
		description: "Start Linc's guided legal matter initialization",
		async handler(args, ctx) {
			if (!ctx.hasUI) {
				throw new Error("/init requires an interactive session.");
			}

			const vault = getAttachedVault(ctx.sessionManager);
			if (!vault) {
				ctx.ui.notify("Attach a Case.dev vault before running /init", "warning");
				return;
			}

			pi.sendUserMessage(await buildMatterInitPrompt(ctx, args.trim()));
		},
	});

	pi.registerCommand("autoinit", {
		description: "Explore the attached Case.dev vault and draft MATTER.md",
		async handler(args, ctx) {
			if (!ctx.hasUI) {
				throw new Error("/autoinit requires an interactive session.");
			}

			const vault = getAttachedVault(ctx.sessionManager);
			if (!vault) {
				ctx.ui.notify("Attach a Case.dev vault before running /autoinit", "warning");
				return;
			}

			pi.sendUserMessage(await buildMatterAutoInitPrompt(ctx, args.trim()));
		},
	});
};

export default matterExtension;
