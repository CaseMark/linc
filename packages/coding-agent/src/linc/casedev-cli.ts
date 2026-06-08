import type { ExtensionContext } from "../core/extensions/types.ts";
import { spawnProcess } from "../utils/child-process.ts";
import { CASEDEV_PROVIDER_ID } from "./casedev-auth.ts";

const CASEDEV_CLI_TIMEOUT_MS = 60_000;

export interface CaseDevCliResult {
	stdout: string;
	stderr: string;
	code: number;
}

export async function getCaseDevApiKey(ctx: ExtensionContext): Promise<string> {
	const apiKey = await ctx.modelRegistry.authStorage.getApiKey(CASEDEV_PROVIDER_ID, { includeFallback: false });
	if (!apiKey) {
		throw new Error("No Case.dev API key configured. Run /login and choose Case.dev API key.");
	}
	return apiKey;
}

export async function runCaseDevCli(
	ctx: ExtensionContext,
	args: string[],
	signal: AbortSignal | undefined,
): Promise<CaseDevCliResult> {
	const apiKey = await getCaseDevApiKey(ctx);
	return new Promise((resolve, reject) => {
		const child = spawnProcess("casedev", ["--json", "--no-color", "--api-key", apiKey, ...args], {
			cwd: ctx.cwd,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		let timeout: NodeJS.Timeout | undefined;

		const cleanup = () => {
			if (timeout) clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
		};
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			fn();
		};
		const abort = () => {
			child.kill("SIGTERM");
			finish(() => reject(new Error("Operation aborted")));
		};

		if (signal?.aborted) {
			abort();
			return;
		}

		signal?.addEventListener("abort", abort, { once: true });
		timeout = setTimeout(() => {
			child.kill("SIGTERM");
			finish(() => reject(new Error(`casedev command timed out after ${CASEDEV_CLI_TIMEOUT_MS / 1000}s`)));
		}, CASEDEV_CLI_TIMEOUT_MS);

		child.stdout?.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => {
			finish(() => reject(new Error(`Failed to run casedev: ${error.message}`)));
		});
		child.on("close", (code) => {
			finish(() =>
				resolve({
					stdout,
					stderr,
					code: code ?? 0,
				}),
			);
		});
	});
}

export function formatCaseDevCliResult(result: CaseDevCliResult): string {
	const stdout = result.stdout.trim();
	const stderr = result.stderr.trim();
	if (result.code === 0) {
		return stdout || stderr || "(no output)";
	}
	const output = [stdout, stderr].filter((value) => value.length > 0).join("\n\n");
	throw new Error(output || `casedev exited with code ${result.code}`);
}
