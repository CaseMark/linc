import { createHash } from "node:crypto";
import type { Api, Model } from "@earendil-works/pi-ai";

const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const RENEW_BEFORE_MS = 5 * 60 * 1000;
const UPLOAD_CONCURRENCY = 4;

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
		options.signal?.throwIfAborted();
		let endpoint: URL | undefined;
		let scope = "";
		const images = new Map<
			string,
			{ sha256: string; mimeType: string; data: string; targets: { url: string }[]; expiresAt: number }
		>();
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
				if (!endpoint) {
					endpoint = new URL(options.baseUrl);
					const pathname = endpoint.pathname.replace(/\/+$/, "");
					if (!pathname.endsWith("/llm/v1")) throw new Error("Invalid Case.dev inference endpoint");
					endpoint.pathname = `${pathname.slice(0, -"/llm/v1".length)}/linc/v1/images`;
					endpoint.search = "";
					endpoint.hash = "";
					scope = createHash("sha256")
						.update(`${endpoint.href}:${options.apiKey}:${options.sessionId}`)
						.digest("hex");
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
				const target = { ...part.image_url, url: source };
				let image = images.get(cacheKey);
				if (!image) {
					image = { sha256, mimeType, data, targets: [], expiresAt: 0 };
					images.set(cacheKey, image);
				}
				image.targets.push(target);
				content.push({ ...part, image_url: target });
			}
			messages.push({ ...message, content });
		}
		if (!endpoint) return payload;
		const uploadEndpoint = endpoint;
		const uploads = [...images];
		const controller = new AbortController();
		const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
		let nextImage = 0;
		const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, uploads.length) }, async () => {
			while (nextImage < uploads.length) {
				signal.throwIfAborted();
				const [cacheKey, image] = uploads[nextImage++];
				let cached = this.urls.get(cacheKey);
				if (!cached || cached.expiresAt <= Date.now() + RENEW_BEFORE_MS) {
					const bypass = process.env.CASEDEV_VERCEL_PROTECTION_BYPASS;
					const response = await fetch(uploadEndpoint, {
						method: "POST",
						headers: {
							Authorization: `Bearer ${options.apiKey}`,
							"Content-Type": "application/json",
							...(bypass ? { "x-vercel-protection-bypass": bypass } : {}),
						},
						body: JSON.stringify({
							sessionId: options.sessionId,
							sha256: image.sha256,
							mimeType: image.mimeType,
							data: image.data,
						}),
						// A large history can take longer than one upload's deadline.
						signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
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
				image.expiresAt = cached.expiresAt;
				for (const target of image.targets) target.url = cached.url;
			}
		});
		try {
			await Promise.all(workers);
		} catch (error) {
			controller.abort();
			await Promise.allSettled(workers);
			throw error;
		}
		signal.throwIfAborted();
		// Earlier cached or uploaded URLs must still be usable at dispatch.
		if (uploads.some(([, image]) => image.expiresAt <= Date.now() + RENEW_BEFORE_MS)) {
			throw new Error("Runtime image URLs need renewal after a long upload; retry the request");
		}
		return { ...payload, messages };
	}
}
