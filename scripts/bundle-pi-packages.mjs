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
 * The bundle has to be self-contained. npm treats every dependency of a bundled package
 * that dedupes into the bundling package's node_modules as bundled too and never fetches
 * it (arborist `Node.getBundler`), so 0.79.17, which bundled only the three pi packages,
 * installed from the registry without openai, partial-json and the rest of their
 * runtime dependencies. The generated npm-shrinkwrap.json flags that closure `inBundle`;
 * this script copies exactly those entries from the repo root node_modules into
 * packages/coding-agent/node_modules at the same relative paths, checks their versions
 * against the shrinkwrap, and refuses to overwrite anything it did not create itself.
 * `npm pack` then follows the bundled packages' dependency edges into the copies.
 *
 * Usage: node scripts/bundle-pi-packages.mjs [--clean]
 */

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const codingAgentDir = join(repoRoot, "packages/coding-agent");
const bundleRoot = join(codingAgentDir, "node_modules/@earendil-works");
const shrinkwrapPath = join(codingAgentDir, "npm-shrinkwrap.json");
/** Records the dependency-closure copies so --clean removes exactly what this script created. */
const manifestPath = join(codingAgentDir, "node_modules/.linc-bundle-manifest.json");

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

/**
 * Shrinkwrap paths (relative to packages/coding-agent) of the external packages the
 * bundled pi packages need at runtime. They are the `inBundle` entries the shrinkwrap
 * generator flagged, minus the pi packages themselves, parents before nested children.
 */
export function bundledDependencyClosure(shrinkwrap = JSON.parse(readFileSync(shrinkwrapPath, "utf8"))) {
	const piPaths = new Set(BUNDLED_PI_PACKAGES.map((pkg) => `node_modules/${pkg.name}`));
	return Object.entries(shrinkwrap.packages)
		.filter(([lockPath, entry]) => lockPath && entry.inBundle === true && !piPaths.has(lockPath))
		.map(([lockPath, entry]) => ({ lockPath, version: entry.version }))
		.sort((a, b) => a.lockPath.length - b.lockPath.length || a.lockPath.localeCompare(b.lockPath));
}

function readManifest() {
	if (!existsSync(manifestPath)) return [];
	return JSON.parse(readFileSync(manifestPath, "utf8")).paths ?? [];
}

function bundleDependencyClosure(log) {
	const closure = bundledDependencyClosure();
	const previouslyCreated = new Set(readManifest());
	const created = [];

	for (const { lockPath, version } of closure) {
		const sourceDir = join(repoRoot, lockPath);
		const targetDir = join(codingAgentDir, lockPath);
		const sourcePackageJson = join(sourceDir, "package.json");
		if (!existsSync(sourcePackageJson)) {
			throw new Error(`${lockPath} is not installed at the repo root. Run npm ci before bundling.`);
		}
		const installedVersion = JSON.parse(readFileSync(sourcePackageJson, "utf8")).version;
		if (installedVersion !== version) {
			throw new Error(
				`${lockPath} is ${installedVersion} at the repo root but npm-shrinkwrap.json expects ${version}. Run npm ci and npm run shrinkwrap:coding-agent.`,
			);
		}

		// A real directory here that this script did not create is npm's own nested install
		// for packages/coding-agent (a version conflict with the repo root). Overwriting it
		// would ship that other version inside the bundle, silently; 0.79.17 packed an
		// example extension's @anthropic-ai/sdk 0.52.0 this way.
		if (existsSync(targetDir) || isSymlink(targetDir)) {
			if (isSymlink(targetDir) || !previouslyCreated.has(lockPath)) {
				throw new Error(
					`packages/coding-agent/${lockPath} already exists and was not created by this script. ` +
						`Resolve the nested dependency so it dedupes to the repo root, then re-run.`,
				);
			}
			rmSync(targetDir, { recursive: true, force: true });
		}

		mkdirSync(dirname(targetDir), { recursive: true });
		cpSync(sourceDir, targetDir, {
			recursive: true,
			dereference: true,
			// Nested closure entries have their own shrinkwrap path and are copied by it.
			filter: (path) => !/\/node_modules(\/|$)/.test(path.slice(sourceDir.length)),
		});
		created.push(lockPath);
		writeFileSync(manifestPath, `${JSON.stringify({ paths: created }, null, "\t")}\n`);
	}

	log(`bundled ${created.length} dependency packages of the pi packages (from npm-shrinkwrap.json inBundle entries)`);
}

function isSymlink(path) {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
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

	bundleDependencyClosure(log);
}

export function cleanBundledPiPackages({ log = console.log } = {}) {
	// Remove only the directories this script creates: the three pi copies and the
	// closure copies listed in the manifest. A symlink at one of these paths is npm's own
	// workspace link and is left alone; anything else under node_modules is not ours to touch.
	for (const pkg of BUNDLED_PI_PACKAGES) {
		const targetDir = bundledPackageDir(pkg.name);
		if (!existsSync(targetDir) || lstatSync(targetDir).isSymbolicLink()) continue;
		rmSync(targetDir, { recursive: true, force: true });
		log(`removed ${targetDir.slice(repoRoot.length + 1)}`);
	}

	const created = readManifest();
	for (const lockPath of created) {
		const targetDir = join(codingAgentDir, lockPath);
		if (isSymlink(targetDir)) continue;
		rmSync(targetDir, { recursive: true, force: true });
		removeEmptyScopeDir(dirname(targetDir));
	}
	if (created.length > 0) {
		log(`removed ${created.length} bundled dependency copies`);
	}
	rmSync(manifestPath, { force: true });
	removeEmptyScopeDir(bundleRoot);
}

/** Drop a now-empty `@scope` directory this script's copies were created under. */
function removeEmptyScopeDir(dir) {
	if (!basename(dir).startsWith("@") || !existsSync(dir) || isSymlink(dir)) return;
	if (readdirSync(dir).length > 0) return;
	rmSync(dir, { recursive: true, force: true });
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
