import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "dark-linc-script-"));
	tempDirs.push(dir);
	return dir;
}

describe("dark-linc package launcher", () => {
	it("runs the built dist CLI in an installed package layout", () => {
		const packageRoot = join(createTempDir(), "node_modules", "@casemark", "linc");
		mkdirSync(join(packageRoot, "scripts"), { recursive: true });
		mkdirSync(join(packageRoot, "dist"), { recursive: true });
		const resolvedPackageRoot = realpathSync(packageRoot);
		copyFileSync(resolve(__dirname, "../scripts/dark-linc.mjs"), join(packageRoot, "scripts", "dark-linc.mjs"));
		writeFileSync(
			join(packageRoot, "dist", "cli.js"),
			[
				"#!/usr/bin/env node",
				"console.log(JSON.stringify({",
				"  variant: process.env.PI_CONFIG_VARIANT,",
				"  agentDir: process.env.LINC_CODING_AGENT_DIR,",
				"  packageDir: process.env.LINC_PACKAGE_DIR,",
				"  args: process.argv.slice(2),",
				"}));",
			].join("\n"),
			"utf-8",
		);

		const result = spawnSync(process.execPath, [join(packageRoot, "scripts", "dark-linc.mjs"), "--version"], {
			cwd: dirname(packageRoot),
			encoding: "utf-8",
			env: {
				...process.env,
				DARK_LINC_AGENT_DIR: "/tmp/custom-dark-linc-agent",
			},
		});

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toEqual({
			variant: "dark-linc",
			agentDir: "/tmp/custom-dark-linc-agent",
			packageDir: resolvedPackageRoot,
			args: ["--version"],
		});
	});
});
