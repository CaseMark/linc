import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import subagentExtension from "../examples/extensions/subagent/index.ts";
import { ENV_AGENT_DIR } from "../src/config.ts";
import type { ExtensionAPI } from "../src/core/extensions/index.ts";

type RegisteredTool = {
	name: string;
	execute: (
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: { cwd: string; hasUI: boolean; ui: unknown },
	) => Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>;
};

function registerSubagentTool(): RegisteredTool {
	let tool: RegisteredTool | undefined;
	const api = {
		registerTool: (definition: RegisteredTool) => {
			tool = definition;
		},
	} as unknown as ExtensionAPI;
	subagentExtension(api);
	if (!tool) throw new Error("subagent extension did not register a tool");
	return tool;
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content.map((part) => part.text ?? "").join("\n");
}

describe("subagent example extension: invalid parameters", () => {
	let tmpRoot: string;
	let projectCwd: string;
	let previousAgentDir: string | undefined;

	beforeEach(() => {
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-invalid-"));
		// Empty user agent dir so the test never reads the developer's ~/.pi.
		const userAgentDir = path.join(tmpRoot, "user-agent-dir");
		fs.mkdirSync(path.join(userAgentDir, "agents"), { recursive: true });
		previousAgentDir = process.env[ENV_AGENT_DIR];
		process.env[ENV_AGENT_DIR] = userAgentDir;

		// A project with one project-scoped agent, mirroring the sandbox layout.
		projectCwd = path.join(tmpRoot, "workspace");
		fs.mkdirSync(path.join(projectCwd, ".pi", "agents"), { recursive: true });
		fs.writeFileSync(
			path.join(projectCwd, ".pi", "agents", "vault-researcher.md"),
			"---\nname: vault-researcher\ndescription: Reviews vault documents\n---\nYou review documents.\n",
		);
	});

	afterEach(() => {
		if (previousAgentDir === undefined) delete process.env[ENV_AGENT_DIR];
		else process.env[ENV_AGENT_DIR] = previousAgentDir;
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	});

	test("agent without task is an error, names the modes, and points at project agents", async () => {
		const tool = registerSubagentTool();
		const result = await tool.execute(
			"call-1",
			{ agent: "vault-researcher", cwd: projectCwd, confirmProjectAgents: false },
			undefined,
			undefined,
			{ cwd: projectCwd, hasUI: false, ui: {} },
		);

		expect(result.isError).toBe(true);
		const text = textOf(result);
		expect(text).toContain("Invalid parameters");
		expect(text).toContain("single (agent + task)");
		expect(text).toContain("Available agents (user scope): none");
		expect(text).toContain(path.join(projectCwd, ".pi", "agents"));
		expect(text).toContain('agentScope: "project" or "both"');
	});

	test("no mode at all is an error even when agents are discoverable", async () => {
		const tool = registerSubagentTool();
		const result = await tool.execute("call-2", { agentScope: "project" }, undefined, undefined, {
			cwd: projectCwd,
			hasUI: false,
			ui: {},
		});

		expect(result.isError).toBe(true);
		const text = textOf(result);
		expect(text).toContain("Available agents (project scope): vault-researcher (project)");
		expect(text).not.toContain("pass agentScope");
	});

	test("more than one mode is an error", async () => {
		const tool = registerSubagentTool();
		const result = await tool.execute(
			"call-3",
			{
				agent: "vault-researcher",
				task: "review",
				tasks: [{ agent: "vault-researcher", task: "review" }],
				agentScope: "project",
			},
			undefined,
			undefined,
			{ cwd: projectCwd, hasUI: false, ui: {} },
		);

		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("Provide exactly one mode");
	});

	test("unknown agent in single mode is still an error", async () => {
		const tool = registerSubagentTool();
		const result = await tool.execute(
			"call-4",
			{ agent: "does-not-exist", task: "review", agentScope: "project" },
			undefined,
			undefined,
			{ cwd: projectCwd, hasUI: false, ui: {} },
		);

		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain('Unknown agent: "does-not-exist"');
	});
});
