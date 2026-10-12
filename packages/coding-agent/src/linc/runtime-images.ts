import { createHash } from "node:crypto";
import type { Api, Model } from "@earendil-works/pi-ai";

const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const RENEW_BEFORE_MS = 5 * 60 * 1000;

export function usesRuntimeImages(model: Model<Api>): boolean {
	return model.api === "openai-completions" && (model.provider === "casedev" || model.provider === "casemark-core");
}

/** URL cache is disposable. Native history retains bytes, and the server's
 * content-addressed conditional PUT deduplicates after restart or key rotation. */
export class RuntimeImages {
	private readonly urls = new Map<string, { url: string; expiresAt: number }>();

	async prepare(
		payload: unknown,
		options: {
			baseUrl: string;
			apiKey: string;
			sessionId: string;
			signal?: AbortSignal;
		},
	): Promise<unknown> {
		if (!payload || typeof payload !== "object" || !("messages" in payload) || !Array.isArray(payload.messages)) {
			return payload;
		}
		const endpoint = new URL(options.baseUrl);
		if (!endpoint.pathname.endsWith("/llm/v1")) throw new Error("Invalid Case.dev inference endpoint");
		endpoint.pathname = `${endpoint.pathname.slice(0, -"/llm/v1".length)}/linc/v1/images`;
		endpoint.search = "";
		endpoint.hash = "";
		// Bound the entire preparation phase, so earlier URLs cannot expire
		// while a later upload stalls. Preserve user cancellation throughout.
		const timeout = AbortSignal.timeout(60_000);
		const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
		const scope = createHash("sha256")
			.update(`${endpoint.href}:${options.apiKey}:${options.sessionId}`)
			.digest("hex");
		const messages = [];
		for (const message of payload.messages as unknown[]) {
			if (!message || typeof message !== "object" || !("content" in message) || !Array.isArray(message.content)) {
				messages.push(message);
				continue;
			}
			const content = [];
			for (const part of message.content as unknown[]) {
				if (
					!part ||
					typeof part !== "object" ||
					!("type" in part) ||
					part.type !== "image_url" ||
					!("image_url" in part) ||
					!part.image_url ||
					typeof part.image_url !== "object" ||
					!("url" in part.image_url) ||
					typeof part.image_url.url !== "string"
				) {
					content.push(part);
					continue;
				}
				const source = part.image_url.url;
				if (!source.startsWith("data:")) {
					content.push(part);
					continue;
				}
				const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
				if (!match) throw new Error("Unsupported inline image format");
				const [, mimeType, data] = match;
				if (data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new Error("Runtime image exceeds 1.5 MiB");
				const bytes = Buffer.from(data, "base64");
				if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== data) {
					throw new Error("Invalid runtime image encoding or size");
				}
				const sha256 = createHash("sha256").update(bytes).digest("hex");
				const cacheKey = `${scope}:${sha256}:${mimeType}`;
				let cached = this.urls.get(cacheKey);
				if (!cached || cached.expiresAt <= Date.now() + RENEW_BEFORE_MS) {
					const bypass = process.env.CASEDEV_VERCEL_PROTECTION_BYPASS;
					const response = await fetch(endpoint, {
						method: "POST",
						headers: {
							Authorization: `Bearer ${options.apiKey}`,
							"Content-Type": "application/json",
							...(bypass ? { "x-vercel-protection-bypass": bypass } : {}),
						},
						body: JSON.stringify({ sessionId: options.sessionId, sha256, mimeType, data }),
						signal,
					});
					// Never include server response bodies: they may contain signed URLs.
					if (!response.ok) throw new Error(`Runtime image upload failed (${response.status})`);
					const result = (await response.json()) as { url?: unknown; expiresAt?: unknown };
					const expiresAt = typeof result.expiresAt === "string" ? Date.parse(result.expiresAt) : NaN;
					if (
						typeof result.url !== "string" ||
						!result.url.startsWith("https://") ||
						!Number.isFinite(expiresAt) ||
						expiresAt <= Date.now() + RENEW_BEFORE_MS
					) {
						throw new Error("Runtime image service returned an invalid URL or insufficient lifetime");
					}
					cached = { url: result.url, expiresAt };
					this.urls.set(cacheKey, cached);
				}
				content.push({ ...part, image_url: { ...part.image_url, url: cached.url } });
			}
			messages.push({ ...message, content });
		}
		return { ...payload, messages };
	}
}
