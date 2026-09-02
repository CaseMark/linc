import type { Message } from "@earendil-works/pi-ai";

// Total base64 image bytes allowed per model request. Every image in the
// conversation is re-sent on every request, and proxy-fronted endpoints
// (api.case.dev) reject request bodies over ~4.5MB with 413 — a limit the
// per-image resize cap alone cannot enforce across a whole conversation.
export const DEFAULT_IMAGE_BYTE_BUDGET = 2.5 * 1024 * 1024;

const IMAGE_OMITTED_TEXT =
	"[image omitted to keep the request under the transport size limit; read the file again if it is still needed]";

/**
 * Cap the total base64 image bytes across a converted message list.
 *
 * Walks newest-first so the images most likely to matter (the ones just
 * produced) survive, and replaces older images with a short text placeholder
 * once the budget is spent. Messages without images are returned unchanged.
 */
export function capImageBytes(messages: Message[], budget = DEFAULT_IMAGE_BYTE_BUDGET): Message[] {
	let remaining = budget;
	const result = new Array<Message>(messages.length);
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		const content = (msg as { content?: unknown }).content;
		if ((msg.role !== "user" && msg.role !== "toolResult") || !Array.isArray(content)) {
			result[i] = msg;
			continue;
		}
		let changed = false;
		const newContent = [...content];
		for (let j = newContent.length - 1; j >= 0; j--) {
			const item = newContent[j] as { type?: string; data?: unknown };
			if (item?.type !== "image" || typeof item.data !== "string") continue;
			if (item.data.length <= remaining) {
				remaining -= item.data.length;
				continue;
			}
			newContent[j] = { type: "text", text: IMAGE_OMITTED_TEXT };
			changed = true;
		}
		result[i] = changed ? ({ ...msg, content: newContent } as Message) : msg;
	}
	return result;
}
