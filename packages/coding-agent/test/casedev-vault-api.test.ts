import { mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import {
	downloadCaseDevVaultObject,
	listCaseDevVaults,
	readCaseDevVaultObjectText,
	searchCaseDevVault,
	uploadCaseDevVaultFile,
} from "../src/linc/casedev-vault-api.ts";

function createContext(cwd: string) {
	return {
		cwd,
		signal: undefined,
		modelRegistry: {
			authStorage: {
				getApiKey: vi.fn(async () => "sk_case_test"),
			},
		},
	} as unknown as ExtensionContext;
}

function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json" },
	});
}

type PutCapture = {
	url: string;
	server: Server;
	requests: Array<{ headers: Record<string, string | string[] | undefined>; bytes: number; body: string }>;
	close: () => Promise<void>;
};

// The S3 PUT no longer goes through fetch (it streams via http.request), so
// stand up a real local endpoint for it and capture what arrives.
async function startPutCapture(status = 200): Promise<PutCapture> {
	const requests: PutCapture["requests"] = [];
	const server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		let bytes = 0;
		req.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes <= 1024) chunks.push(chunk);
		});
		req.on("end", () => {
			requests.push({ headers: req.headers, bytes, body: Buffer.concat(chunks).toString("utf-8") });
			res.writeHead(status, { etag: '"abc"' });
			res.end();
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
	const { port } = server.address() as { port: number };
	return {
		url: `http://127.0.0.1:${port}/upload?X-Amz-Signature=test`,
		server,
		requests,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

describe("Case.dev vault REST API helper", () => {
	let cwd: string;
	const originalCaseDevBaseUrl = process.env.CASEDEV_API_BASE_URL;
	const originalCaseDevBaseUrlAlt = process.env.CASEDEV_BASE_URL;
	const originalCaseApiUrl = process.env.CASE_API_URL;
	const originalVercelProtectionBypass = process.env.CASEDEV_VERCEL_PROTECTION_BYPASS;

	beforeEach(async () => {
		cwd = await mkdtemp(join(tmpdir(), "linc-vault-api-test-"));
		process.env.CASEDEV_API_BASE_URL = "https://preview.api.case.dev";
		delete process.env.CASEDEV_BASE_URL;
		delete process.env.CASE_API_URL;
		delete process.env.CASEDEV_VERCEL_PROTECTION_BYPASS;
	});

	afterEach(async () => {
		await rm(cwd, { recursive: true, force: true });
		vi.unstubAllGlobals();
		if (originalCaseDevBaseUrl === undefined) delete process.env.CASEDEV_API_BASE_URL;
		else process.env.CASEDEV_API_BASE_URL = originalCaseDevBaseUrl;
		if (originalCaseDevBaseUrlAlt === undefined) delete process.env.CASEDEV_BASE_URL;
		else process.env.CASEDEV_BASE_URL = originalCaseDevBaseUrlAlt;
		if (originalCaseApiUrl === undefined) delete process.env.CASE_API_URL;
		else process.env.CASE_API_URL = originalCaseApiUrl;
		if (originalVercelProtectionBypass === undefined) delete process.env.CASEDEV_VERCEL_PROTECTION_BYPASS;
		else process.env.CASEDEV_VERCEL_PROTECTION_BYPASS = originalVercelProtectionBypass;
	});

	it("lists vaults through the REST API with the stored Case.dev key", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				vaults: [
					{ id: "vault-1", name: "Alpha", totalObjects: 2 },
					{ id: "", name: "Ignored" },
				],
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(listCaseDevVaults(createContext(cwd))).resolves.toEqual([
			{ id: "vault-1", name: "Alpha", totalObjects: 2 },
		]);

		expect(fetchMock).toHaveBeenCalledWith("https://preview.api.case.dev/vault", {
			method: "GET",
			headers: { Authorization: "Bearer sk_case_test" },
			body: undefined,
			signal: undefined,
		});
	});

	it("searches a vault with REST filters instead of CLI flags", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ chunks: [{ objectId: "obj-1", text: "match" }] }));
		vi.stubGlobal("fetch", fetchMock);

		await searchCaseDevVault(createContext(cwd), "vault-1", {
			query: "last line",
			method: "hybrid",
			limit: 5,
			objectIds: ["obj-1", "obj-2"],
		});

		expect(fetchMock).toHaveBeenCalledWith("https://preview.api.case.dev/vault/vault-1/search", {
			method: "POST",
			headers: {
				Authorization: "Bearer sk_case_test",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				query: "last line",
				method: "hybrid",
				topK: 5,
				filters: { object_id: ["obj-1", "obj-2"] },
			}),
			signal: undefined,
		});
	});

	it("forwards the Vercel protection bypass on REST requests", async () => {
		process.env.CASEDEV_VERCEL_PROTECTION_BYPASS = "preview-bypass";
		const fetchMock = vi.fn(async () => jsonResponse({ vaults: [] }));
		vi.stubGlobal("fetch", fetchMock);

		await listCaseDevVaults(createContext(cwd));

		expect(fetchMock).toHaveBeenCalledWith("https://preview.api.case.dev/vault", {
			method: "GET",
			headers: {
				Authorization: "Bearer sk_case_test",
				"x-vercel-protection-bypass": "preview-bypass",
			},
			body: undefined,
			signal: undefined,
		});
	});

	it("downloads a vault object to a local file", async () => {
		const fetchMock = vi.fn(async () => new Response("downloaded text", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		const result = await downloadCaseDevVaultObject(createContext(cwd), {
			vaultId: "vault-1",
			objectId: "obj-1",
			outDir: cwd,
			filename: "MATTER.md",
		});

		expect(result).toEqual({
			objectId: "obj-1",
			path: join(cwd, "MATTER.md"),
			bytes: "downloaded text".length,
		});
		await expect(readFile(join(cwd, "MATTER.md"), "utf-8")).resolves.toBe("downloaded text");
		expect(fetchMock).toHaveBeenCalledWith("https://preview.api.case.dev/vault/vault-1/objects/obj-1/download", {
			method: "GET",
			headers: { Authorization: "Bearer sk_case_test" },
			signal: undefined,
		});
	});

	it("forwards the Vercel protection bypass on streaming downloads", async () => {
		process.env.CASEDEV_VERCEL_PROTECTION_BYPASS = "preview-bypass";
		const fetchMock = vi.fn(async () => new Response("downloaded text", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await downloadCaseDevVaultObject(createContext(cwd), {
			vaultId: "vault-1",
			objectId: "obj-1",
			outDir: cwd,
		});

		expect(fetchMock).toHaveBeenCalledWith("https://preview.api.case.dev/vault/vault-1/objects/obj-1/download", {
			method: "GET",
			headers: {
				Authorization: "Bearer sk_case_test",
				"x-vercel-protection-bypass": "preview-bypass",
			},
			signal: undefined,
		});
	});

	it("streams multi-chunk download bodies to disk", async () => {
		const chunkA = new TextEncoder().encode("a".repeat(64 * 1024));
		const chunkB = new TextEncoder().encode("b".repeat(64 * 1024));
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(chunkA);
				controller.enqueue(chunkB);
				controller.close();
			},
		});
		const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		const result = await downloadCaseDevVaultObject(createContext(cwd), {
			vaultId: "vault-1",
			objectId: "obj-big",
			outDir: cwd,
			filename: "big-original.pdf",
		});

		expect(result).toEqual({
			objectId: "obj-big",
			path: join(cwd, "big-original.pdf"),
			bytes: chunkA.byteLength + chunkB.byteLength,
		});
		await expect(readFile(join(cwd, "big-original.pdf"), "utf-8")).resolves.toBe(
			"a".repeat(64 * 1024) + "b".repeat(64 * 1024),
		);
	});

	it("writes extracted object text into the workspace with page-marker stats", async () => {
		const text = "--- Page 1 ---\nFirst page body\n\n--- Page 2 ---\nSecond page body";
		const fetchMock = vi.fn(async () =>
			jsonResponse({ text, metadata: { filename: "report.pdf", length: text.length } }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await readCaseDevVaultObjectText(createContext(cwd), {
			vaultId: "vault-1",
			objectId: "obj-1",
			outDir: cwd,
		});

		expect(result).toMatchObject({
			objectId: "obj-1",
			path: join(cwd, "report.pdf.txt"),
			chars: text.length,
			pageMarkers: 2,
		});
		expect(result.note).toContain("page numbers");
		await expect(readFile(join(cwd, "report.pdf.txt"), "utf-8")).resolves.toBe(text);
		expect(fetchMock).toHaveBeenCalledWith("https://preview.api.case.dev/vault/vault-1/objects/obj-1/text", {
			method: "GET",
			headers: { Authorization: "Bearer sk_case_test" },
			body: undefined,
			signal: undefined,
		});
	});

	it("writes large extracted text to disk in full with grep-first guidance", async () => {
		const text = "x".repeat(50_000);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => jsonResponse({ text, metadata: { filename: "long.pdf" } })),
		);

		const result = await readCaseDevVaultObjectText(createContext(cwd), {
			vaultId: "vault-1",
			objectId: "obj-long",
			outDir: cwd,
		});

		expect(result).toMatchObject({
			objectId: "obj-long",
			chars: text.length,
		});
		expect(result.note).toContain("grep -n");
		expect(result.note).toContain("Never page through the full text");
		// The on-disk file is complete: disk is outside model context and free,
		// and grep over the whole text is what enables large-document analysis.
		const written = await readFile(join(cwd, "long.pdf.txt"), "utf-8");
		expect(written).toBe(text);
	});

	it("rejects text reads for objects with no extracted text", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ text: "" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			readCaseDevVaultObjectText(createContext(cwd), {
				vaultId: "vault-1",
				objectId: "obj-empty",
				outDir: cwd,
			}),
		).rejects.toThrow("no extracted text");
	});

	it("uploads, confirms, and ingests a vault file through REST", async () => {
		const filePath = join(cwd, "note.md");
		await writeFile(filePath, "# Note\n", "utf-8");
		const put = await startPutCapture();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({
					objectId: "obj-1",
					uploadUrl: put.url,
					next_step: "POST /vault/vault-1/ingest/obj-1",
				}),
			)
			.mockResolvedValueOnce(jsonResponse({ status: "completed" }))
			.mockResolvedValueOnce(jsonResponse({ status: "processing" }));
		vi.stubGlobal("fetch", fetchMock);

		try {
			await uploadCaseDevVaultFile(createContext(cwd), {
				vaultId: "vault-1",
				filePath,
				name: "note.md",
				contentType: "text/markdown",
			});
		} finally {
			await put.close();
		}

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"https://preview.api.case.dev/vault/vault-1/upload",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({
					filename: "note.md",
					contentType: "text/markdown",
					sizeBytes: 7,
					auto_index: true,
				}),
			}),
		);
		// The S3 PUT streams from disk with an explicit Content-Length (presigned
		// PUTs reject chunked encoding) and never passes through fetch.
		expect(put.requests).toHaveLength(1);
		expect(put.requests[0].headers["content-type"]).toBe("text/markdown");
		expect(put.requests[0].headers["content-length"]).toBe("7");
		expect(put.requests[0].headers["transfer-encoding"]).toBeUndefined();
		expect(put.requests[0].body).toBe("# Note\n");
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"https://preview.api.case.dev/vault/vault-1/upload/obj-1/confirm",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ success: true, sizeBytes: 7, etag: '"abc"' }),
			}),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			3,
			"https://preview.api.case.dev/vault/vault-1/ingest/obj-1",
			expect.objectContaining({ method: "POST" }),
		);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("reports a failed S3 PUT to confirm and surfaces the status", async () => {
		const filePath = join(cwd, "note.md");
		await writeFile(filePath, "# Note\n", "utf-8");
		const put = await startPutCapture(403);
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ objectId: "obj-1", uploadUrl: put.url }))
			.mockResolvedValueOnce(jsonResponse({ status: "failed" }));
		vi.stubGlobal("fetch", fetchMock);

		try {
			await expect(
				uploadCaseDevVaultFile(createContext(cwd), { vaultId: "vault-1", filePath, ingest: false }),
			).rejects.toThrow("S3 upload failed with status 403");
		} finally {
			await put.close();
		}
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"https://preview.api.case.dev/vault/vault-1/upload/obj-1/confirm",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({
					success: false,
					errorCode: "HTTP_403",
					errorMessage: "S3 upload failed with status 403",
				}),
			}),
		);
	});

	it("streams large deliverables at constant memory", async () => {
		const filePath = join(cwd, "organized.zip");
		const sizeBytes = 500 * 1024 * 1024;
		// Sparse file: 500 MB of zeros with no disk allocation.
		await writeFile(filePath, "");
		await truncate(filePath, sizeBytes);
		const put = await startPutCapture();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ objectId: "obj-2", uploadUrl: put.url }))
			.mockResolvedValueOnce(jsonResponse({ status: "completed" }));
		vi.stubGlobal("fetch", fetchMock);

		// Regression guard for CD-1604: the old readFile + fetch path held ~4x
		// the file in ArrayBuffers and OOM-killed the sandbox. Track live
		// ArrayBuffer memory (not RSS, which lags GC) while the upload runs.
		const baseline = process.memoryUsage().arrayBuffers;
		let peak = baseline;
		const sampler = setInterval(() => {
			peak = Math.max(peak, process.memoryUsage().arrayBuffers);
		}, 5);
		try {
			await uploadCaseDevVaultFile(createContext(cwd), {
				vaultId: "vault-1",
				filePath,
				contentType: "application/zip",
				ingest: false,
			});
		} finally {
			clearInterval(sampler);
			await put.close();
		}

		expect(put.requests[0].bytes).toBe(sizeBytes);
		expect(put.requests[0].headers["content-length"]).toBe(String(sizeBytes));
		expect(peak - baseline).toBeLessThan(64 * 1024 * 1024);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	}, 30_000);
});
