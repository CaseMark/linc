#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLED_PI_PACKAGES, bundledDependencyClosure, bundlePiPackages, cleanBundledPiPackages } from "./bundle-pi-packages.mjs";

const packages = [
	{ directory: "packages/coding-agent", name: "@casemark/linc" },
];

const dryRun = process.argv.includes("--dry-run");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--dry-run");

if (unknownArgs.length > 0) {
	console.error(`Usage: node scripts/publish.mjs [--dry-run]`);
	process.exit(1);
}

function commandForPlatform(command) {
	return process.platform === "win32" ? `${command}.cmd` : command;
}

function run(command, args, options = {}) {
	console.log(`$ ${[command, ...args].join(" ")}`);
	const result = spawnSync(commandForPlatform(command), args, {
		cwd: options.cwd,
		encoding: "utf8",
		stdio: options.capture ? ["inherit", "pipe", "pipe"] : "inherit",
		// `npm pack --json` lists every bundled file; the default 1 MiB buffer truncates it.
		maxBuffer: 256 * 1024 * 1024,
	});

	if (result.status !== 0) {
		const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
		throw new Error(output ? `Command failed: ${command} ${args.join(" ")}\n${output}` : `Command failed: ${command} ${args.join(" ")}`);
	}

	return result;
}

function readPackageJson(directory) {
	return JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
}

function assertBuildOutputExists(directory) {
	if (!existsSync(join(directory, "dist"))) {
		throw new Error(`${directory}/dist does not exist. Run npm run build before publishing.`);
	}
}

function validatePack(directory) {
	const result = run("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], { capture: true, cwd: directory });
	const packed = JSON.parse(result.stdout)[0];
	console.log(`  ${packed.filename}: ${packed.files.length} files, ${packed.size} bytes packed, ${packed.unpackedSize} bytes unpacked`);

	// The pi workspace builds must ride inside the tarball; the registry copies under
	// these names are upstream's and lack our changes (see scripts/bundle-pi-packages.mjs).
	// A package.json alone would also pass with an empty or stale dist, so assert the
	// built entry points and the pieces each package cannot run without.
	const paths = new Set(packed.files.map((file) => file.path));
	const required = BUNDLED_PI_PACKAGES.flatMap((pkg) => [
		`node_modules/${pkg.name}/package.json`,
		`node_modules/${pkg.name}/dist/index.js`,
	]);
	required.push("node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js");
	for (const marker of required) {
		if (!paths.has(marker)) {
			throw new Error(`${packed.filename} does not bundle the pi workspace builds (missing ${marker})`);
		}
	}
	if (![...paths].some((path) => /^node_modules\/@earendil-works\/pi-tui\/native\/.*\.node$/.test(path))) {
		throw new Error(`${packed.filename} bundles pi-tui without its native prebuilds`);
	}
	const bundledFileCount = packed.files.filter((file) => file.path.startsWith("node_modules/@earendil-works/")).length;
	console.log(`  bundled ${BUNDLED_PI_PACKAGES.length} pi packages (${bundledFileCount} files)`);

	// The bundle must be self-contained: npm never fetches a bundled package's dependencies
	// that dedupe into this package's node_modules (see scripts/bundle-pi-packages.mjs).
	// Every inBundle shrinkwrap entry has to be in the tarball, and nothing else under
	// node_modules may ride along (a stray nested install would ship the wrong version).
	const closure = bundledDependencyClosure();
	const bundledPaths = new Set([...closure.map((entry) => entry.lockPath), ...BUNDLED_PI_PACKAGES.map((pkg) => `node_modules/${pkg.name}`)]);
	for (const lockPath of bundledPaths) {
		if (!paths.has(`${lockPath}/package.json`)) {
			throw new Error(`${packed.filename} is missing bundled dependency ${lockPath} (npm-shrinkwrap.json marks it inBundle)`);
		}
	}
	const stray = [...paths].filter((path) => path.startsWith("node_modules/") && !packageDirOf(path, bundledPaths));
	if (stray.length > 0) {
		throw new Error(`${packed.filename} bundles files outside the shrinkwrap's inBundle entries:\n  ${stray.slice(0, 10).join("\n  ")}`);
	}
	const closureFileCount = packed.files.filter((file) => file.path.startsWith("node_modules/") && !file.path.startsWith("node_modules/@earendil-works/")).length;
	console.log(`  bundled ${closure.length} dependency packages of the pi packages (${closureFileCount} files)`);
}

/** Longest bundled package path that `path` lives under, or undefined for a stray file. */
function packageDirOf(path, bundledPaths) {
	let best;
	for (const lockPath of bundledPaths) {
		if (path.startsWith(`${lockPath}/`) && (!best || lockPath.length > best.length)) {
			best = lockPath;
		}
	}
	return best;
}

function isPublished(name, version) {
	const result = spawnSync(commandForPlatform("npm"), ["view", `${name}@${version}`, "version", "--json"], {
		encoding: "utf8",
		stdio: ["inherit", "pipe", "pipe"],
	});

	if (result.status === 0 && result.stdout.trim()) {
		return true;
	}

	const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
	if (result.status !== 0 && (output.includes("E404") || output.includes("404 Not Found"))) {
		return false;
	}

	throw new Error(output ? `Failed to query ${name}@${version}\n${output}` : `Failed to query ${name}@${version}`);
}

const packageVersions = new Map();
for (const pkg of packages) {
	const packageJson = readPackageJson(pkg.directory);
	if (packageJson.name !== pkg.name) {
		throw new Error(`${pkg.directory}/package.json has name ${packageJson.name}, expected ${pkg.name}`);
	}
	packageVersions.set(pkg.name, packageJson.version);
}

const versions = [...new Set(packageVersions.values())];
if (versions.length !== 1) {
	throw new Error(`Publish packages are not lockstep versioned: ${versions.join(", ")}`);
}

console.log(`Publishing linc package at ${versions[0]}${dryRun ? " (dry run)" : ""}\n`);

try {
	bundlePiPackages();
	console.log();

	for (const pkg of packages) {
		const version = packageVersions.get(pkg.name);
		assertBuildOutputExists(pkg.directory);
		const published = isPublished(pkg.name, version);

		if (dryRun) {
			if (published) {
				console.log(`${pkg.name}@${version} is already published; validating package contents only.`);
			} else {
				console.log(`${pkg.name}@${version} is not published; validating package contents before publish.`);
			}
			validatePack(pkg.directory);
			console.log();
			continue;
		}

		if (published) {
			console.log(`Skipping ${pkg.name}@${version}: already published\n`);
			continue;
		}

		validatePack(pkg.directory);
		run("npm", ["publish", "--access", "public", "--provenance", "--ignore-scripts"], { cwd: pkg.directory });
		console.log();
	}
} finally {
	cleanBundledPiPackages();
}
