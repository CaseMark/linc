import type { Message } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { capImageBytes } from "../src/utils/image-budget.ts";

function toolResultWithImage(data: string): Message {
	return {
		role: "toolResult",
		toolCallId: "call_1",
		toolName: "read",
		content: [
			{ type: "text", text: "Read image file" },
			{ type: "image", data, mimeType: "image/png" },
		],
		isError: false,
	} as unknown as Message;
}

describe("capImageBytes", () => {
	it("keeps everything when images fit the budget", () => {
		const messages = [toolResultWithImage("a".repeat(100)), toolResultWithImage("b".repeat(100))];
		expect(capImageBytes(messages, 1000)).toEqual(messages);
	});

	it("drops the oldest images first once the budget is spent", () => {
		const oldest = toolResultWithImage("a".repeat(600));
		const newest = toolResultWithImage("b".repeat(600));
		const [cappedOldest, keptNewest] = capImageBytes([oldest, newest], 1000);

		expect(keptNewest).toEqual(newest);
		const content = (cappedOldest as { content: Array<{ type: string; text?: string }> }).content;
		expect(content[0]).toEqual({ type: "text", text: "Read image file" });
		expect(content[1].type).toBe("text");
		expect(content[1].text).toContain("image omitted");
	});

	it("leaves assistant messages and non-array content untouched", () => {
		const assistant = { role: "assistant", content: [{ type: "text", text: "hi" }] } as unknown as Message;
		const user = { role: "user", content: "plain string" } as unknown as Message;
		expect(capImageBytes([assistant, user], 0)).toEqual([assistant, user]);
	});
});
