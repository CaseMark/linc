import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const codingAgentDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(codingAgentDir, "../..");
const bundleScript = join(repoRoot, "scripts/bundle-pi-packages.mjs");
const workspaceDists = ["packages/agent/dist", "packages/ai/dist", "packages/tui/dist"].map((p) => join(repoRoot, p));
const built = workspaceDists.every((dir) => existsSync(dir));

function node(args: string[], cwd: string) {
	const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8" });
	if (result.status !== 0) throw new Error(`${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
	return result.stdout;
}

function npmPackDryRun(cwd: string): Set<string> {
	const npm = process.platform === "win32" ? "npm.cmd" : "npm";
	const result = spawnSync(npm, ["pack", "--dry-run", "--ignore-scripts", "--json"], { cwd, encoding: "utf8" });
	if (result.status !== 0) throw new Error(`npm pack --dry-run failed:\n${result.stderr}`);
	const packed = JSON.parse(result.stdout)[0] as { files: Array<{ path: string }> };
	return new Set(packed.files.map((f) => f.path));
}

// The published @casemark/linc must carry OUR pi-agent-core / pi-ai / pi-tui builds. The
// registry packages under those names are upstream's and stop at 0.79.10, so without
// bundling every CaseMark change to packages/agent|ai|tui compiles and tests locally and
// never runs in a sandbox. CI builds before it tests; locally this skips until `npm run build`.
describe.skipIf(!built)("release bundle: pi workspace packages ride inside the linc tarball", () => {
	afterAll(() => {
		node([bundleScript, "--clean"], repoRoot);
	});

	it("npm pack includes the bundled packages after the bundle step, and none before it", () => {
		node([bundleScript, "--clean"], repoRoot);
		const before = npmPackDryRun(codingAgentDir);
		expect([...before].some((p) => p.startsWith("node_modules/@earendil-works/"))).toBe(false);

		node([bundleScript], repoRoot);
		const after = npmPackDryRun(codingAgentDir);
		for (const name of ["pi-agent-core", "pi-ai", "pi-tui"]) {
			expect(after.has(`node_modules/@earendil-works/${name}/package.json`)).toBe(true);
			expect(after.has(`node_modules/@earendil-works/${name}/dist/index.js`)).toBe(true);
		}
		// The loop hooks the coding-agent relies on live in the bundled agent package.
		expect(after.has("node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js")).toBe(true);
		// pi-tui's native prebuilds are part of its published surface.
		expect([...after].some((p) => /node_modules\/@earendil-works\/pi-tui\/native\/.*\.node$/.test(p))).toBe(true);
		// Source and tests stay out.
		expect([...after].some((p) => /node_modules\/@earendil-works\/[^/]+\/(src|test)\//.test(p))).toBe(false);
	});
});
