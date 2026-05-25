#!/usr/bin/env node

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = join(repoRoot, ".github", "upstream-pi.json");

function runGit(args, options = {}) {
	const result = spawnSync("git", args, {
		cwd: repoRoot,
		encoding: "utf8",
		...options,
	});
	if (result.status !== 0) {
		const stderr = result.stderr.trim();
		const stdout = result.stdout.trim();
		throw new Error(`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ""}`);
	}
	return result.stdout.trim();
}

function parseArgs(argv) {
	const args = { output: undefined, noFetch: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--output" && i + 1 < argv.length) {
			args.output = argv[++i];
			continue;
		}
		if (arg === "--no-fetch") {
			args.noFetch = true;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return args;
}

function shortSha(sha) {
	return sha.slice(0, 8);
}

function readConfig() {
	return JSON.parse(readFileSync(configPath, "utf8"));
}

function groupPath(filePath) {
	const parts = filePath.split("/");
	if (parts[0] === "packages" && parts[1]) {
		return `packages/${parts[1]}`;
	}
	if (parts[0] === ".github") {
		return parts[1] === "workflows" ? ".github/workflows" : ".github";
	}
	if (parts[0] === "scripts") {
		return "scripts";
	}
	if (parts[0] === "package.json" || parts[0] === "package-lock.json" || parts[0] === "tsconfig.json") {
		return "root config";
	}
	return parts[0] || "(root)";
}

function formatCommitLines(logOutput) {
	if (!logOutput) return ["No commits."];
	return logOutput.split("\n").map((line) => {
		const [sha, date, ...subjectParts] = line.split("\t");
		return `- ${sha} ${date} ${subjectParts.join("\t")}`;
	});
}

function buildPathSummary(diffNameStatus) {
	const groups = new Map();
	for (const line of diffNameStatus.split("\n").filter(Boolean)) {
		const [status, rawPath] = line.split("\t");
		const filePath = rawPath ?? "";
		const group = groupPath(filePath);
		const current = groups.get(group) ?? { total: 0, added: 0, modified: 0, deleted: 0 };
		current.total++;
		if (status.startsWith("A")) current.added++;
		else if (status.startsWith("D")) current.deleted++;
		else current.modified++;
		groups.set(group, current);
	}

	return [...groups.entries()]
		.sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
		.map(([group, counts]) => `- ${group}: ${counts.total} files (${counts.added} added, ${counts.modified} modified, ${counts.deleted} deleted)`);
}

function buildRiskNotes(diffNameStatus) {
	const paths = diffNameStatus.split("\n").filter(Boolean).map((line) => line.split("\t").at(-1) ?? "");
	const notes = [];
	if (paths.some((path) => path.startsWith("packages/agent/"))) {
		notes.push("- `packages/agent` should track `@earendil-works/pi-agent-core` without Linc-specific changes.");
	}
	if (paths.some((path) => path.includes("providers") || path.includes("models"))) {
		notes.push("- Provider/model changes need manual Linc filtering because Linc routes through case.dev only.");
	}
	if (paths.some((path) => path.includes("auth") || path.includes("oauth") || path.includes("env-api-keys"))) {
		notes.push("- Auth changes need manual review against `CASEDEV_API_KEY` and `linc login`.");
	}
	if (paths.some((path) => path.startsWith("packages/coding-agent/docs/"))) {
		notes.push("- Docs changes can be structure-forked, but assertions must be rewritten for Linc.");
	}
	if (paths.some((path) => basename(path) === "package-lock.json" || basename(path) === "package.json")) {
		notes.push("- Dependency changes should be ported as explicit package updates, not by wholesale lockfile replacement.");
	}
	if (paths.some((path) => path.startsWith("packages/mom/") || path.startsWith("packages/pods/"))) {
		notes.push("- Pi removed or reshaped packages that Linc still carries; package deletions are not automatically portable.");
	}
	return notes.length > 0 ? notes : ["- No obvious Linc-specific risk markers found in changed paths."];
}

function buildPackagePolicyLines(config) {
	const packagePolicy = config.packagePolicy;
	if (!packagePolicy?.packages) {
		return ["No package policy configured."];
	}

	const lines = [
		`Source upstream: ${packagePolicy.sourceUpstream ?? config.remote}`,
		`Bundle package: ${packagePolicy.bundlePackage ?? "(unspecified)"}`,
		"",
	];
	for (const [name, policy] of Object.entries(packagePolicy.packages)) {
		lines.push(`- ${name}: ${policy.upstreamPath} -> ${policy.localPath}`);
		if (policy.lincSubpath) {
			lines.push(`  Linc import: \`${policy.lincSubpath}\``);
		}
		lines.push(`  Policy: ${policy.policy}`);
	}
	return lines;
}

function writeGithubOutput(values) {
	const outputPath = process.env.GITHUB_OUTPUT;
	if (!outputPath) return;
	const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
	appendFileSync(outputPath, `${lines.join("\n")}\n`);
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const config = readConfig();

	if (!args.noFetch) {
		runGit(["fetch", "--quiet", config.remote, config.branch]);
	}

	const upstreamHead = runGit(["rev-parse", "FETCH_HEAD"]);
	const base = config.lastReviewedSha;
	runGit(["merge-base", "--is-ancestor", base, upstreamHead]);

	const commitCount = Number(runGit(["rev-list", "--count", `${base}..${upstreamHead}`]));
	const commitLog = runGit(["log", "--reverse", "--date=short", "--format=%h%x09%ad%x09%s", `${base}..${upstreamHead}`]);
	const diffNameStatus = runGit(["diff", "--name-status", `${base}..${upstreamHead}`]);
	const pathSummary = buildPathSummary(diffNameStatus);
	const riskNotes = buildRiskNotes(diffNameStatus);

	const body = [
		"# Upstream Pi Review",
		"",
		`Remote: ${config.remote}`,
		`Branch: ${config.branch}`,
		`Reviewed base: ${base}`,
		`Upstream head: ${upstreamHead}`,
		`Commits pending review: ${commitCount}`,
		"",
		"## How To Review",
		"",
		"```bash",
		"git fetch pi",
		`git log --oneline --reverse ${shortSha(base)}..${shortSha(upstreamHead)}`,
		`git diff --stat ${shortSha(base)}..${shortSha(upstreamHead)}`,
		"```",
		"",
		"Port useful changes with explicit cherry-picks or hand edits. Do not merge `pi/main` into Linc.",
		"",
		"## Path Summary",
		"",
		...(pathSummary.length > 0 ? pathSummary : ["No file changes."]),
		"",
		"## Linc Review Notes",
		"",
		...riskNotes,
		"",
		"## Package Policy",
		"",
		...buildPackagePolicyLines(config),
		"",
		"## Commits",
		"",
		...formatCommitLines(commitLog),
		"",
		"## After Review",
		"",
		`If this range is accepted or intentionally skipped, update \`.github/upstream-pi.json\` to set \`lastReviewedSha\` to \`${upstreamHead}\`.`,
		"",
	].join("\n");

	if (args.output) {
		const outputPath = isAbsolute(args.output) ? args.output : join(repoRoot, args.output);
		writeFileSync(outputPath, body);
	} else {
		console.log(body);
	}

	writeGithubOutput({
		has_changes: commitCount > 0 ? "true" : "false",
		base,
		upstream_head: upstreamHead,
		commit_count: String(commitCount),
	});
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
