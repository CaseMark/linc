import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const codingAgentDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(codingAgentDir, "../..");
const bundleScript = join(repoRoot, "scripts/bundle-pi-packages.mjs");
const shrinkwrap = JSON.parse(readFileSync(join(codingAgentDir, "npm-shrinkwrap.json"), "utf8")) as {
	packages: Record<string, { version?: string; inBundle?: boolean; resolved?: string }>;
};
const inBundlePaths = Object.entries(shrinkwrap.packages)
	.filter(([lockPath, entry]) => lockPath && entry.inBundle === true)
	.map(([lockPath]) => lockPath);
const workspaceDists = ["packages/agent/dist", "packages/ai/dist", "packages/tui/dist"].map((p) => join(repoRoot, p));
const built = workspaceDists.every((dir) => existsSync(dir));

function node(args: string[], cwd: string) {
	const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8" });
	if (result.status !== 0) throw new Error(`${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
	return result.stdout;
}

function npmPackDryRun(cwd: string): Set<string> {
	const npm = process.platform === "win32" ? "npm.cmd" : "npm";
	// The JSON lists every bundled file; the default 1 MiB buffer truncates it.
	const result = spawnSync(npm, ["pack", "--dry-run", "--ignore-scripts", "--json"], {
		cwd,
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
	});
	if (result.status !== 0) throw new Error(`npm pack --dry-run failed:\n${result.stderr}`);
	const packed = JSON.parse(result.stdout)[0] as { files: Array<{ path: string }> };
	return new Set(packed.files.map((f) => f.path));
}

// The published @casemark/linc must carry OUR pi-agent-core / pi-ai / pi-tui builds. The
// registry packages under those names are upstream's and stop at 0.79.10, so without
// bundling every CaseMark change to packages/agent|ai|tui compiles and tests locally and
// never runs in a sandbox. CI builds before it tests; locally this skips until `npm run build`.
// Bundling copies ~100 packages and `npm pack --dry-run` walks 15k files, which takes
// tens of seconds on a CI runner. Bundle and pack once and share the listing.
const TEST_TIMEOUT_MS = 300_000;
let packedAfterBundle: Set<string> | undefined;
function bundleAndPack(): Set<string> {
	if (!packedAfterBundle) {
		node([bundleScript], repoRoot);
		packedAfterBundle = npmPackDryRun(codingAgentDir);
	}
	return packedAfterBundle;
}

describe.skipIf(!built)("release bundle: pi workspace packages ride inside the linc tarball", () => {
	afterAll(() => {
		node([bundleScript, "--clean"], repoRoot);
	});

	it(
		"npm pack includes the bundled packages after the bundle step, and none before it",
		() => {
			node([bundleScript, "--clean"], repoRoot);
			const before = npmPackDryRun(codingAgentDir);
			// Nothing under node_modules rides along by itself: a nested install here would be
			// packed as a bundled dependency (0.79.17 shipped an example's @anthropic-ai/sdk 0.52.0).
			expect([...before].some((p) => p.startsWith("node_modules/"))).toBe(false);

			const after = bundleAndPack();
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
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"bundles the pi packages' whole runtime dependency closure, and nothing else under node_modules",
		() => {
			const after = bundleAndPack();

			// npm never fetches a bundled package's dependencies that dedupe into this package's
			// node_modules, so every inBundle shrinkwrap entry has to be inside the tarball.
			expect(inBundlePaths.length).toBeGreaterThan(3);
			for (const lockPath of [
				"node_modules/openai",
				"node_modules/partial-json",
				"node_modules/typebox",
				"node_modules/@anthropic-ai/sdk",
			]) {
				expect(inBundlePaths).toContain(lockPath);
			}
			for (const lockPath of inBundlePaths) {
				expect(after.has(`${lockPath}/package.json`), `${lockPath} missing from the tarball`).toBe(true);
				expect(
					shrinkwrap.packages[lockPath].resolved,
					`${lockPath} is bundled and must not resolve to the registry`,
				).toBeUndefined();
			}

			// Anything else under node_modules is a stray nested install, not part of the bundle.
			const packageDirOf = (path: string) =>
				inBundlePaths.filter((lockPath) => path.startsWith(`${lockPath}/`)).sort((a, b) => b.length - a.length)[0];
			const stray = [...after].filter((p) => p.startsWith("node_modules/") && !packageDirOf(p));
			expect(stray).toEqual([]);

			// The copies are the versions the shrinkwrap pins, taken from the repo root install.
			for (const lockPath of ["node_modules/openai", "node_modules/@anthropic-ai/sdk"]) {
				const copied = JSON.parse(readFileSync(join(codingAgentDir, lockPath, "package.json"), "utf8")) as {
					version: string;
				};
				expect(copied.version).toBe(shrinkwrap.packages[lockPath].version);
			}
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"--clean removes every copy it made",
		() => {
			bundleAndPack();
			expect(existsSync(join(codingAgentDir, "node_modules/openai"))).toBe(true);
			node([bundleScript, "--clean"], repoRoot);
			packedAfterBundle = undefined;
			expect(existsSync(join(codingAgentDir, "node_modules/openai"))).toBe(false);
			expect(existsSync(join(codingAgentDir, "node_modules/@earendil-works/pi-ai"))).toBe(false);
			expect(existsSync(join(codingAgentDir, "node_modules/.linc-bundle-manifest.json"))).toBe(false);
		},
		TEST_TIMEOUT_MS,
	);
});
