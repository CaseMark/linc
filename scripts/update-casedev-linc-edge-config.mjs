#!/usr/bin/env node

import { readFileSync } from "node:fs";

const EDGE_CONFIG_KEYS = {
	preview: "linc-preview-version",
	production: "linc-production-version",
};

function getArgValue(flag) {
	const index = process.argv.indexOf(flag);
	if (index === -1) return undefined;
	return process.argv[index + 1];
}

function hasFlag(flag) {
	return process.argv.includes(flag);
}

function usage() {
	return [
		"Usage: node scripts/update-casedev-linc-edge-config.mjs [--channel preview|production|both] [--version x.y.z] [--dry-run]",
		"",
		"Required env when not using --dry-run:",
		"  CASEDEV_LINC_EDGE_CONFIG_ID",
		"  CASEDEV_LINC_EDGE_CONFIG_VERCEL_TOKEN",
		"",
		"Optional env:",
		"  CASEDEV_LINC_EDGE_CONFIG_TEAM_ID",
		"  CASEDEV_LINC_EDGE_CONFIG_TEAM_SLUG",
	].join("\n");
}

function readPackageVersion() {
	const packageJson = JSON.parse(readFileSync("packages/coding-agent/package.json", "utf8"));
	if (packageJson.name !== "@casemark/linc") {
		throw new Error(`Unexpected package name: ${packageJson.name}`);
	}
	return packageJson.version;
}

function normalizeVersion(version) {
	if (typeof version !== "string") return null;
	const trimmed = version.trim();
	return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(trimmed) ? trimmed : null;
}

function resolveChannels(channel) {
	if (!channel || channel === "preview") return ["preview"];
	if (channel === "production") return ["production"];
	if (channel === "both") return ["preview", "production"];
	throw new Error(`Invalid channel: ${channel}`);
}

function buildEndpoint(edgeConfigId) {
	const url = new URL(`https://api.vercel.com/v1/edge-config/${edgeConfigId}/items`);
	if (process.env.CASEDEV_LINC_EDGE_CONFIG_TEAM_ID) {
		url.searchParams.set("teamId", process.env.CASEDEV_LINC_EDGE_CONFIG_TEAM_ID);
	}
	if (process.env.CASEDEV_LINC_EDGE_CONFIG_TEAM_SLUG) {
		url.searchParams.set("slug", process.env.CASEDEV_LINC_EDGE_CONFIG_TEAM_SLUG);
	}
	return url.toString();
}

async function main() {
	if (hasFlag("--help")) {
		console.log(usage());
		return;
	}

	const version = normalizeVersion(getArgValue("--version") ?? readPackageVersion());
	if (!version) {
		throw new Error(`Invalid Linc version: ${getArgValue("--version")}`);
	}

	const channels = resolveChannels(getArgValue("--channel") ?? process.env.CASEDEV_LINC_EDGE_CONFIG_CHANNEL);
	const items = channels.map((channel) => ({
		operation: "upsert",
		key: EDGE_CONFIG_KEYS[channel],
		value: version,
	}));

	if (hasFlag("--dry-run")) {
		for (const item of items) {
			console.log(`[dry-run] ${item.key} = ${item.value}`);
		}
		return;
	}

	const edgeConfigId = process.env.CASEDEV_LINC_EDGE_CONFIG_ID;
	const vercelToken = process.env.CASEDEV_LINC_EDGE_CONFIG_VERCEL_TOKEN;
	if (!edgeConfigId || !vercelToken) {
		throw new Error(
			"CASEDEV_LINC_EDGE_CONFIG_ID and CASEDEV_LINC_EDGE_CONFIG_VERCEL_TOKEN are required"
		);
	}

	const response = await fetch(buildEndpoint(edgeConfigId), {
		method: "PATCH",
		headers: {
			Authorization: `Bearer ${vercelToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ items }),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Edge Config update failed (${response.status}): ${errorText}`);
	}

	for (const item of items) {
		console.log(`Updated Case.dev Edge Config: ${item.key} = ${item.value}`);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
