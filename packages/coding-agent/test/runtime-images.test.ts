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
	vi.useRealTimers();
});

describe("runtime image transport", () => {
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
