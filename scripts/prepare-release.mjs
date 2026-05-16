#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const release = process.argv[2];

if (!release || !/^(major|minor|patch|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.test(release)) {
	console.error("Usage: node scripts/prepare-release.mjs <major|minor|patch|x.y.z>");
	process.exit(1);
}

function run(command, options = {}) {
	console.log(`$ ${command}`);
	return execSync(command, { encoding: "utf8", stdio: options.silent ? "pipe" : "inherit" });
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function getVersion() {
	return readJson("packages/coding-agent/package.json").version;
}

function getChangelogs() {
	return readdirSync("packages")
		.map((packageName) => join("packages", packageName, "CHANGELOG.md"))
		.filter((path) => existsSync(path));
}

function updateChangelog(path, version) {
	const content = readFileSync(path, "utf8");
	if (!content.includes("## [Unreleased]")) {
		console.log(`Skipping ${path}: no [Unreleased] section`);
		return;
	}

	const date = new Date().toISOString().slice(0, 10);
	const updated = content.replace("## [Unreleased]", `## [Unreleased]\n\n## [${version}] - ${date}`);
	writeFileSync(path, updated);
	console.log(`Updated ${path}`);
}

const status = run("git status --porcelain", { silent: true });
if (status.trim()) {
	console.error("Working tree is not clean:");
	console.error(status);
	process.exit(1);
}

if (release === "major" || release === "minor" || release === "patch") {
	run(`npm version ${release} --workspaces --no-git-tag-version`);
} else {
	run(`npm version ${release} --workspaces --no-git-tag-version`);
}

run("node scripts/sync-versions.js");

const version = getVersion();
for (const changelog of getChangelogs()) {
	updateChangelog(changelog, version);
}

console.log(`Prepared release v${version}`);
