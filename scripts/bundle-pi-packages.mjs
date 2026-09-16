#!/usr/bin/env node
/**
 * Bundle the built pi workspace packages into the @casemark/linc tarball.
 *
 * @casemark/linc depends on @earendil-works/pi-agent-core, pi-ai and pi-tui. Those
 * names belong to upstream pi, so our forks under packages/agent, packages/ai and
 * packages/tui cannot be published under them. Without bundling, `npm install
 * @casemark/linc` fetched upstream's last 0.79.x publish (0.79.10) from the registry
 * and every CaseMark change to those packages was compiled and tested locally but
 * never ran in a sandbox.
 *
 * npm's `bundleDependencies` only bundles what sits under the package's own
 * node_modules as a real directory; the workspace symlinks hoisted to the repo root
 * are skipped. This script copies each built workspace package into
 * packages/coding-agent/node_modules/@earendil-works/<name> before `npm pack` /
 * `npm publish`, and `--clean` removes the copies afterwards so local resolution goes
 * back to the workspace symlinks.
 *
 * Usage: node scripts/bundle-pi-packages.mjs [--clean]
 */

import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const codingAgentDir = join(repoRoot, "packages/coding-agent");
const bundleRoot = join(codingAgentDir, "node_modules/@earendil-works");

export const BUNDLED_PI_PACKAGES = [
	{ workspace: "packages/agent", name: "@earendil-works/pi-agent-core" },
	{ workspace: "packages/ai", name: "@earendil-works/pi-ai" },
	{ workspace: "packages/tui", name: "@earendil-works/pi-tui" },
];

/** Files every bundled copy carries besides the package's own `files` globs. */
const ALWAYS_COPY = ["package.json", "README.md", "LICENSE"];

function topLevelDirFromFilesEntry(entry) {
	// "dist", "dist/**/*", "native/win32/prebuilds/**/*.node" → "dist", "dist", "native"
	return entry.split("/")[0].replace(/\*.*$/, "");
}

export function bundledPackageDir(name) {
	return join(bundleRoot, name.split("/")[1]);
}

export function bundlePiPackages({ log = console.log } = {}) {
	for (const pkg of BUNDLED_PI_PACKAGES) {
		const sourceDir = join(repoRoot, pkg.workspace);
		const packageJson = JSON.parse(readFileSync(join(sourceDir, "package.json"), "utf8"));
		if (packageJson.name !== pkg.name) {
			throw new Error(`${pkg.workspace}/package.json is ${packageJson.name}, expected ${pkg.name}`);
		}
		if (!existsSync(join(sourceDir, "dist"))) {
			throw new Error(`${pkg.workspace}/dist does not exist. Run npm run build before bundling.`);
		}

		const targetDir = bundledPackageDir(pkg.name);
		rmSync(targetDir, { recursive: true, force: true });
		mkdirSync(targetDir, { recursive: true });

		const roots = new Set(ALWAYS_COPY);
		for (const entry of packageJson.files ?? ["dist"]) {
			roots.add(topLevelDirFromFilesEntry(entry));
		}
		for (const root of roots) {
			const source = join(sourceDir, root);
			if (!existsSync(source)) continue;
			cpSync(source, join(targetDir, root), {
				recursive: true,
				dereference: true,
				filter: (path) => !/\/node_modules(\/|$)/.test(path) && !/\/(src|test|tests)(\/|$)/.test(path.slice(sourceDir.length)),
			});
		}
		log(`bundled ${pkg.name}@${packageJson.version} → ${targetDir.slice(repoRoot.length + 1)}`);
	}
}

export function cleanBundledPiPackages({ log = console.log } = {}) {
	// Remove only the three directories this script creates. A symlink at one of these
	// paths is npm's own workspace link and is left alone; anything else under the scope
	// is not ours to touch.
	for (const pkg of BUNDLED_PI_PACKAGES) {
		const targetDir = bundledPackageDir(pkg.name);
		if (!existsSync(targetDir) || lstatSync(targetDir).isSymbolicLink()) continue;
		rmSync(targetDir, { recursive: true, force: true });
		log(`removed ${targetDir.slice(repoRoot.length + 1)}`);
	}
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const args = new Set(process.argv.slice(2));
	for (const arg of args) {
		if (arg !== "--clean") {
			console.error(`Unknown argument: ${arg}`);
			process.exit(1);
		}
	}
	if (args.has("--clean")) {
		cleanBundledPiPackages();
	} else {
		bundlePiPackages();
	}
}
