import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import subagentExtension from "../../../examples/extensions/subagent/index.ts";
import { ENV_AGENT_DIR } from "../../../src/config.ts";
import type { ExtensionAPI } from "../../../src/core/extensions/index.ts";
import { createHarness, type Harness } from "../harness.ts";

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

describe("regression CD-1531: malformed subagent calls are rejected before the tool runs", () => {
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

	test("agent without task is an error when called directly", async () => {
		const tool = registerSubagentTool();
		const result = await tool.execute(
			"call-1",
			{ agent: "vault-researcher", cwd: projectCwd, confirmProjectAgents: false },
			undefined,
			undefined,
			{ cwd: projectCwd, hasUI: false, ui: {} },
		);

		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("Invalid parameters");
	});

	test("the parameter schema itself rejects the malformed shapes before the tool runs", () => {
		const tool = registerSubagentTool();
		const schema = (tool as unknown as { parameters: TSchema }).parameters;
		// Shapes seen in production from GLM-5.3, and the fallback shapes.
		expect(Value.Check(schema, { agent: "vault-researcher", cwd: "/workspace", confirmProjectAgents: false })).toBe(
			false,
		);
		expect(
			Value.Check(schema, { agent: "vault-researcher", agentScope: "project", confirmProjectAgents: false }),
		).toBe(false);
		expect(Value.Check(schema, { agentScope: "project", confirmProjectAgents: false, cwd: "." })).toBe(false);
		expect(Value.Check(schema, { tasks: '[{"agent":"a","task":"t"}]' })).toBe(false);
		// Valid shapes for each mode.
		expect(Value.Check(schema, { agent: "vault-researcher", task: "review", agentScope: "project" })).toBe(true);
		expect(Value.Check(schema, { tasks: [{ agent: "vault-researcher", task: "review" }], agentScope: "both" })).toBe(
			true,
		);
		expect(Value.Check(schema, { chain: [{ agent: "vault-researcher", task: "review {previous}" }] })).toBe(true);
	});

	test("the schema keeps accepting the exact shapes production models send today", () => {
		const tool = registerSubagentTool();
		const schema = (tool as unknown as { parameters: TSchema }).parameters;
		// OpenAI (gpt-5.6-sol/terra, gpt-5.4): every property on every call,
		// empty strings and empty arrays for the unused modes.
		const openaiSingle = {
			cwd: "/workspace",
			task: "Inspect /workspace for injected document templates relevant to a mediation summary.",
			agent: "explore",
			chain: [],
			tasks: [],
			agentScope: "project",
			confirmProjectAgents: false,
		};
		const openaiParallel = {
			cwd: "/workspace",
			task: "",
			agent: "",
			chain: [],
			tasks: [{ cwd: "/workspace", task: "Repair exactly repair-001.json", agent: "vault-researcher" }],
			agentScope: "project",
			confirmProjectAgents: false,
		};
		// DeepSeek (core-lightning): single mode without cwd.
		const deepseekSingle = {
			agent: "vault-researcher",
			agentScope: "project",
			confirmProjectAgents: false,
			task: "review",
		};
		// GLM-5.3 when it gets it right.
		const glmSingle = {
			agent: "vault-researcher",
			agentScope: "project",
			confirmProjectAgents: false,
			task: "review",
		};
		const glmParallel = {
			agentScope: "project",
			confirmProjectAgents: false,
			tasks: [{ agent: "vault-researcher", task: "Search the vault for every document related to Dr. Nora Dado." }],
		};
		for (const shape of [openaiSingle, openaiParallel, deepseekSingle, glmSingle, glmParallel]) {
			expect(Value.Check(schema, shape)).toBe(true);
		}
	});

	test("no mode at all is an error even when agents are discoverable", async () => {
		const tool = registerSubagentTool();
		const result = await tool.execute("call-2", { agentScope: "project" }, undefined, undefined, {
			cwd: projectCwd,
			hasUI: false,
			ui: {},
		});

		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("Available agents: vault-researcher (project)");
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

	test("through the agent loop, the production GLM-5.3 shape is rejected by argument validation as an error", async () => {
		const harness: Harness = await createHarness({
			extensionFactories: [subagentExtension],
			initialActiveToolNames: ["subagent"],
		});
		try {
			harness.setResponses([
				fauxAssistantMessage(
					[
						fauxToolCall("subagent", {
							agent: "vault-researcher",
							cwd: "/workspace",
							confirmProjectAgents: false,
						}),
					],
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("delegate the document review");

			const toolResults = harness.sessionManager
				.getBranch()
				.filter((entry) => entry.type === "message")
				.map((entry) => entry.message)
				.filter((message) => message.role === "toolResult") as Array<{
				isError?: boolean;
				content: Array<{ type: string; text?: string }>;
			}>;
			expect(toolResults).toHaveLength(1);
			expect(toolResults[0].isError).toBe(true);
			const text = textOf(toolResults[0]);
			expect(text).toContain('Validation failed for tool "subagent"');
			expect(text).toContain("task");
			// The extension itself never ran: its own message is not what came back.
			expect(text).not.toContain("Invalid parameters. Provide exactly one mode");
		} finally {
			harness.cleanup();
		}
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
