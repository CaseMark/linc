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

	it("keeps a smaller older image when a larger newer image exceeds the budget", () => {
		// Newest-first priority means the newest image gets first claim on the
		// budget, but an oversized newest image does not starve older ones that
		// still fit in the remainder.
		const older = toolResultWithImage("a".repeat(800));
		const newest = toolResultWithImage("b".repeat(1200));
		const [keptOlder, cappedNewest] = capImageBytes([older, newest], 1000);

		expect(keptOlder).toEqual(older);
		const newestContent = (cappedNewest as { content: Array<{ type: string; text?: string }> }).content;
		expect(newestContent[1].type).toBe("text");
		expect(newestContent[1].text).toContain("image omitted");
	});

	it("caps per item when one message holds a fitting and a non-fitting image", () => {
		const message = {
			role: "toolResult",
			toolCallId: "call_1",
			toolName: "read",
			content: [
				{ type: "image", data: "a".repeat(700), mimeType: "image/png" },
				{ type: "image", data: "b".repeat(600), mimeType: "image/png" },
			],
			isError: false,
		} as unknown as Message;
		const [capped] = capImageBytes([message], 1000);

		const content = (capped as { content: Array<{ type: string; data?: string; text?: string }> }).content;
		// Within a message the later item is newer and wins the budget.
		expect(content[1]).toEqual({ type: "image", data: "b".repeat(600), mimeType: "image/png" });
		expect(content[0].type).toBe("text");
		expect(content[0].text).toContain("image omitted");
	});

	it("returns image-free array content unchanged", () => {
		const textOnly = {
			role: "user",
			content: [{ type: "text", text: "hello" }],
		} as unknown as Message;
		const [result] = capImageBytes([textOnly], 0);
		expect(result).toBe(textOnly);
	});

	it("leaves assistant messages and non-array content untouched", () => {
		const assistant = { role: "assistant", content: [{ type: "text", text: "hi" }] } as unknown as Message;
		const user = { role: "user", content: "plain string" } as unknown as Message;
		expect(capImageBytes([assistant, user], 0)).toEqual([assistant, user]);
	});
});
