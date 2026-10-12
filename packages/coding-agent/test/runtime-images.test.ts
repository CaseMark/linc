import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeImages } from "../src/linc/runtime-images.ts";

const options = { baseUrl: "https://api.case.dev/llm/v1", apiKey: "test-key", sessionId: "native-session" };
const image = (data = Buffer.from("image").toString("base64")) => ({
	type: "image_url",
	image_url: { url: `data:image/png;base64,${data}`, detail: "high" },
});
const payload = () => ({ messages: [{ role: "user", content: [image()] }] });

function mockUploads() {
	const upload = vi.fn(
		async (_url: URL, _options: RequestInit) =>
			new Response(
				JSON.stringify({
					url: `https://storage.test/image-${upload.mock.calls.length}`,
					expiresAt: new Date(Date.now() + 3600_000).toISOString(),
				}),
				{ headers: { "Content-Type": "application/json" } },
			),
	);
	vi.stubGlobal("fetch", upload);
	return upload;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("runtime image transport", () => {
	it("accepts trailing slashes and does not validate an image endpoint for text-only requests", async () => {
		const upload = mockUploads();
		const textOnly = { messages: [{ role: "user", content: "hello" }] };
		const transport = new RuntimeImages();
		expect(await transport.prepare(textOnly, { ...options, baseUrl: "https://api.case.dev/llm/v1/" })).toBe(textOnly);
		expect(await transport.prepare(textOnly, { ...options, baseUrl: "https://proxy.test/v1" })).toBe(textOnly);
		await transport.prepare(payload(), { ...options, baseUrl: "https://api.case.dev/llm/v1/" });
		expect(upload.mock.calls[0][0].href).toBe("https://api.case.dev/linc/v1/images");
	});

	it("prepares slow histories beyond one minute with bounded uploads and stable image order", async () => {
		vi.useFakeTimers();
		vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
			const controller = new AbortController();
			setTimeout(() => controller.abort(new DOMException("Upload timed out", "TimeoutError")), ms);
			return controller.signal;
		});
		let active = 0;
		let peak = 0;
		const upload = vi.fn(async (_url: URL, init: RequestInit) => {
			active++;
			peak = Math.max(peak, active);
			const { sha256 } = JSON.parse(init.body as string) as { sha256: string };
			await new Promise<void>((resolve, reject) => {
				const onAbort = () => {
					clearTimeout(timer);
					reject(init.signal?.reason);
				};
				const timer = setTimeout(() => {
					init.signal?.removeEventListener("abort", onAbort);
					resolve();
				}, 15_000);
				init.signal?.addEventListener("abort", onAbort, { once: true });
			});
			active--;
			return new Response(
				JSON.stringify({
					url: `https://storage.test/${sha256}`,
					expiresAt: new Date(Date.now() + 3600_000).toISOString(),
				}),
			);
		});
		vi.stubGlobal("fetch", upload);
		const original = {
			messages: [
				{
					role: "user",
					content: Array.from({ length: 30 }, (_, index) =>
						image(Buffer.from(`page-${index}`).toString("base64")),
					),
				},
			],
		};
		const preparing = new RuntimeImages().prepare(original, options);
		await vi.advanceTimersByTimeAsync(120_000);
		const result = (await preparing) as typeof original;
		expect(upload).toHaveBeenCalledTimes(30);
		expect(peak).toBe(4);
		expect(result.messages[0].content.map((part) => part.image_url.url)).toEqual(
			Array.from(
				{ length: 30 },
				(_, index) => `https://storage.test/${createHash("sha256").update(`page-${index}`).digest("hex")}`,
			),
		);
		expect(JSON.stringify(original)).toContain("data:image");
	});

	it("cancels every active upload without starting more work", async () => {
		const controller = new AbortController();
		const upload = vi.fn(
			(_url: URL, init: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
				}),
		);
		vi.stubGlobal("fetch", upload);
		const source = {
			messages: [
				{ content: Array.from({ length: 10 }, (_, index) => image(Buffer.from(`${index}`).toString("base64"))) },
			],
		};
		const preparing = new RuntimeImages().prepare(source, { ...options, signal: controller.signal });
		expect(upload).toHaveBeenCalledTimes(4);
		controller.abort(new Error("User cancelled"));
		await expect(preparing).rejects.toThrow("User cancelled");
		expect(upload).toHaveBeenCalledTimes(4);
	});

	it("cancels sibling uploads when one fails", async () => {
		let cancelled = 0;
		const upload = vi.fn((_url: URL, init: RequestInit) => {
			if (upload.mock.calls.length === 1) return Promise.resolve(new Response("private", { status: 503 }));
			return new Promise<Response>((_resolve, reject) => {
				init.signal?.addEventListener(
					"abort",
					() => {
						cancelled++;
						reject(init.signal?.reason);
					},
					{ once: true },
				);
			});
		});
		vi.stubGlobal("fetch", upload);
		const source = {
			messages: [
				{ content: Array.from({ length: 10 }, (_, index) => image(Buffer.from(`${index}`).toString("base64"))) },
			],
		};
		await expect(new RuntimeImages().prepare(source, options)).rejects.toThrow("upload failed (503)");
		expect(upload).toHaveBeenCalledTimes(4);
		expect(cancelled).toBe(3);
	});

	it("rejects URLs that become stale while a later image uploads", async () => {
		vi.useFakeTimers();
		let advanceClock = false;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				if (advanceClock) vi.setSystemTime(Date.now() + 120_000);
				return new Response(
					JSON.stringify({
						url: "https://storage.test/image",
						expiresAt: new Date(Date.now() + 360_000).toISOString(),
					}),
				);
			}),
		);
		const transport = new RuntimeImages();
		await transport.prepare(payload(), options);
		advanceClock = true;
		const source = { messages: [{ content: [image(), image(Buffer.from("another").toString("base64"))] }] };
		await expect(transport.prepare(source, options)).rejects.toThrow("need renewal after a long upload");
	});

	it("times out a stalled upload and stops the batch", async () => {
		vi.useFakeTimers();
		vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
			const controller = new AbortController();
			setTimeout(() => controller.abort(new DOMException("Upload timed out", "TimeoutError")), ms);
			return controller.signal;
		});
		const upload = vi.fn(
			(_url: URL, init: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
				}),
		);
		vi.stubGlobal("fetch", upload);
		const rejection = expect(new RuntimeImages().prepare(payload(), options)).rejects.toThrow("Upload timed out");
		await vi.advanceTimersByTimeAsync(60_000);
		await rejection;
		expect(upload).toHaveBeenCalledTimes(1);
	});

	it("keeps a 30-image conversation small without changing native history", async () => {
		const upload = mockUploads();
		const original = {
			messages: Array.from({ length: 30 }, (_, index) => ({
				role: "user",
				content: [image(Buffer.alloc(303_000, index).toString("base64"))],
			})),
		};
		expect(JSON.stringify(original).length).toBeGreaterThan(4.5 * 1024 * 1024);
		const transport = new RuntimeImages();
		const request = await transport.prepare(original, options);
		expect(JSON.stringify(request).length).toBeLessThan(10_000);
		expect(JSON.stringify(request)).not.toContain("data:image");
		expect(JSON.stringify(original)).toContain("data:image");
		expect(upload).toHaveBeenCalledTimes(30);
		expect(await transport.prepare(original, options)).toEqual(request);
		expect(upload).toHaveBeenCalledTimes(30);
	});

	it("reuses repeated tool-result images and preserves image detail", async () => {
		const upload = mockUploads();
		const source = { messages: [{ role: "user", content: [image(), image()] }] };
		const result = await new RuntimeImages().prepare(source, options);
		expect(upload).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			messages: [
				{
					role: "user",
					content: [
						{ type: "image_url", image_url: { url: "https://storage.test/image-1", detail: "high" } },
						{ type: "image_url", image_url: { url: "https://storage.test/image-1", detail: "high" } },
					],
				},
			],
		});
	});

	it("renews near expiration and recreates the same object identity after restart", async () => {
		vi.useFakeTimers();
		const upload = mockUploads();
		const transport = new RuntimeImages();
		const original = payload();
		await transport.prepare(original, options);
		vi.advanceTimersByTime(56 * 60_000);
		await transport.prepare(original, options);
		await new RuntimeImages().prepare(original, options);
		expect(upload).toHaveBeenCalledTimes(3);
		const bodies = upload.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string));
		expect(bodies[0]).toEqual(bodies[1]);
		expect(bodies[0]).toEqual(bodies[2]);
		expect(bodies[0].sha256).toBe(createHash("sha256").update("image").digest("hex"));
	});

	it("does not reuse signed capabilities across keys or native sessions", async () => {
		const upload = mockUploads();
		const transport = new RuntimeImages();
		await transport.prepare(payload(), options);
		await transport.prepare(payload(), { ...options, apiKey: "rotated" });
		await transport.prepare(payload(), { ...options, sessionId: "other-session" });
		expect(upload).toHaveBeenCalledTimes(3);
	});

	it("fails without dispatching inline bytes when upload or expiry is invalid", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("private details", { status: 403 })),
		);
		await expect(new RuntimeImages().prepare(payload(), options)).rejects.toThrow("upload failed (403)");
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							url: "https://storage.test/private",
							expiresAt: new Date(Date.now() + 60_000).toISOString(),
						}),
					),
			),
		);
		await expect(new RuntimeImages().prepare(payload(), options)).rejects.toThrow("insufficient lifetime");
	});

	it("rejects oversized or malformed data before uploading", async () => {
		const upload = mockUploads();
		await expect(
			new RuntimeImages().prepare({ messages: [{ content: [image("A".repeat(3_000_000))] }] }, options),
		).rejects.toThrow("exceeds");
		await expect(new RuntimeImages().prepare({ messages: [{ content: [image("A")] }] }, options)).rejects.toThrow(
			"encoding",
		);
		expect(upload).not.toHaveBeenCalled();
	});
});
