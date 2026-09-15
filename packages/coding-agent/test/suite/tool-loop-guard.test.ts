import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSession } from "../../src/core/agent-session.ts";
import type { ExtensionRunner } from "../../src/core/extensions/runner.ts";
import type { ExtensionUIContext } from "../../src/core/extensions/types.ts";
import { createHarness, getAssistantTexts, type Harness } from "./harness.ts";

/**
 * CD-1554: a run that keeps issuing one tool call with byte-identical arguments is
 * stopped at the Nth call. Two Sep 4 2026 production runs repeated one call 1,824
 * and 1,065 times before being stopped by hand; no healthy run in a week of traffic
 * made the same call twice in a row.
 */
describe("tool loop guard", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	const executed: unknown[] = [];
	const echoTool: AgentTool = {
		name: "echo",
		label: "Echo",
		description: "Echo text back",
		parameters: Type.Object({ text: Type.String(), n: Type.Optional(Type.Number()) }),
		execute: async (_id, params) => {
			executed.push(params);
			return { content: [{ type: "text", text: `echoed ${JSON.stringify(params)}` }], details: {} };
		},
	};

	function captureNotices(harness: Harness): Array<{ message: string; type: string | undefined }> {
		const notices: Array<{ message: string; type: string | undefined }> = [];
		const runner = (harness.session as unknown as { _extensionRunner: ExtensionRunner })._extensionRunner;
		runner.setUIContext({
			notify: (message: string, type?: "info" | "warning" | "error") => notices.push({ message, type }),
		} as unknown as ExtensionUIContext);
		return notices;
	}

	function identicalCalls(count: number, args: Record<string, unknown> = { text: "same" }) {
		return Array.from({ length: count }, () =>
			fauxAssistantMessage(fauxToolCall("echo", args), { stopReason: "toolUse" }),
		);
	}

	it("blocks the fifth consecutive identical call, ends the run, and notifies the host", async () => {
		executed.length = 0;
		const harness = await createHarness({ tools: [echoTool] });
		harnesses.push(harness);
		const notices = captureNotices(harness);
		harness.setResponses([...identicalCalls(6), fauxAssistantMessage("should not run")]);

		await harness.session.prompt("loop");

		// Four calls ran; the fifth was blocked and the run ended without another model request.
		expect(executed).toHaveLength(4);
		expect(harness.faux.state.callCount).toBe(5);
		expect(harness.getPendingResponseCount()).toBe(2);
		expect(getAssistantTexts(harness)).not.toContain("should not run");
		expect(harness.session.isStreaming).toBe(false);

		const blocked = harness.session.messages.filter((m) => m.role === "toolResult" && m.isError);
		expect(blocked).toHaveLength(1);
		const blockedText = (blocked[0] as { content: Array<{ type: string; text?: string }> }).content
			.map((c) => c.text ?? "")
			.join("");
		expect(blockedText).toContain('"echo" has now been called 5 times in a row');
		expect(harness.eventsOfType("tool_execution_end").at(-1)?.result).toHaveProperty("terminate", true);

		expect(notices).toEqual([{ message: AgentSession.TOOL_LOOP_GUARD_NOTICE, type: "warning" }]);
	});

	it("treats argument key order as identical", async () => {
		executed.length = 0;
		const harness = await createHarness({ tools: [echoTool] });
		harnesses.push(harness);
		harness.setResponses([
			...identicalCalls(2, { text: "same", n: 1 }),
			...identicalCalls(3, { n: 1, text: "same" }),
			fauxAssistantMessage("should not run"),
		]);

		await harness.session.prompt("loop");

		expect(executed).toHaveLength(4);
		expect(getAssistantTexts(harness)).not.toContain("should not run");
	});

	it("does not fire when arguments change, however often the same tool is used", async () => {
		executed.length = 0;
		const harness = await createHarness({ tools: [echoTool] });
		harnesses.push(harness);
		const notices = captureNotices(harness);
		harness.setResponses([
			...Array.from({ length: 8 }, (_, i) =>
				fauxAssistantMessage(fauxToolCall("echo", { text: `step ${i}` }), { stopReason: "toolUse" }),
			),
			fauxAssistantMessage("finished"),
		]);

		await harness.session.prompt("work");

		expect(executed).toHaveLength(8);
		expect(getAssistantTexts(harness)).toContain("finished");
		expect(notices).toEqual([]);
	});

	it("does not fire on four identical calls followed by a different one", async () => {
		executed.length = 0;
		const harness = await createHarness({ tools: [echoTool] });
		harnesses.push(harness);
		harness.setResponses([
			...identicalCalls(4),
			fauxAssistantMessage(fauxToolCall("echo", { text: "different" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("finished"),
		]);

		await harness.session.prompt("work");

		expect(executed).toHaveLength(5);
		expect(getAssistantTexts(harness)).toContain("finished");
	});

	it("resets the streak at a user message", async () => {
		executed.length = 0;
		const harness = await createHarness({ tools: [echoTool] });
		harnesses.push(harness);
		harness.setResponses([
			...identicalCalls(3),
			fauxAssistantMessage("first done"),
			...identicalCalls(3),
			fauxAssistantMessage("second done"),
		]);

		await harness.session.prompt("first");
		await harness.session.prompt("second");

		expect(executed).toHaveLength(6);
		expect(getAssistantTexts(harness)).toContain("second done");
	});

	it("honors the threshold and the kill switch from settings", async () => {
		executed.length = 0;
		const strict = await createHarness({ tools: [echoTool], settings: { toolLoopGuard: { maxIdenticalCalls: 3 } } });
		harnesses.push(strict);
		strict.setResponses([...identicalCalls(4), fauxAssistantMessage("should not run")]);
		await strict.session.prompt("loop");
		expect(executed).toHaveLength(2);
		expect(getAssistantTexts(strict)).not.toContain("should not run");

		executed.length = 0;
		const off = await createHarness({ tools: [echoTool], settings: { toolLoopGuard: { enabled: false } } });
		harnesses.push(off);
		off.setResponses([...identicalCalls(7), fauxAssistantMessage("finished")]);
		await off.session.prompt("loop");
		expect(executed).toHaveLength(7);
		expect(getAssistantTexts(off)).toContain("finished");
	});
});
