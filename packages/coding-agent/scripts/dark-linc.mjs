#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(packageRoot));
const tsxBin = join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
const distCliPath = join(packageRoot, "dist", "cli.js");
const sourceCliPath = join(packageRoot, "src", "cli.ts");

const command = existsSync(distCliPath) ? process.execPath : tsxBin;
const cliPath = existsSync(distCliPath) ? distCliPath : sourceCliPath;

if (!existsSync(command) || !existsSync(cliPath)) {
	console.error("dark-linc requires a built package or repo dependencies. Run npm install and npm run build.");
	process.exit(1);
}

const result = spawnSync(command, [cliPath, ...process.argv.slice(2)], {
	cwd: process.cwd(),
	env: {
		...process.env,
		LINC_CODING_AGENT_DIR: process.env.DARK_LINC_AGENT_DIR ?? join(homedir(), ".dark-linc", "agent"),
		LINC_PACKAGE_DIR: packageRoot,
		PI_CONFIG_VARIANT: "dark-linc",
	},
	stdio: "inherit",
});

if (result.error) {
	console.error(result.error.message);
	process.exit(1);
}

process.exit(result.status ?? 1);
