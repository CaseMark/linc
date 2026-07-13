import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import {
	CASEDEV_VAULT_TEXT_MAX_CHARS,
	CASEDEV_VAULT_TEXT_TRUNCATION_WARNING,
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

	it("limits extracted object text and prepends targeted-search guidance", async () => {
		const text = "x".repeat(CASEDEV_VAULT_TEXT_MAX_CHARS + 1);
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
			note: CASEDEV_VAULT_TEXT_TRUNCATION_WARNING,
		});
		const written = await readFile(join(cwd, "long.pdf.txt"), "utf-8");
		expect(written).toHaveLength(CASEDEV_VAULT_TEXT_MAX_CHARS);
		expect(written).toBe(
			`${CASEDEV_VAULT_TEXT_TRUNCATION_WARNING}\n\n${"x".repeat(
				CASEDEV_VAULT_TEXT_MAX_CHARS - CASEDEV_VAULT_TEXT_TRUNCATION_WARNING.length - 2,
			)}`,
		);
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
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({
					objectId: "obj-1",
					uploadUrl: "https://s3.test/upload",
					next_step: "POST /vault/vault-1/ingest/obj-1",
				}),
			)
			.mockResolvedValueOnce(new Response("", { status: 200, headers: { etag: '"abc"' } }))
			.mockResolvedValueOnce(jsonResponse({ status: "completed" }))
			.mockResolvedValueOnce(jsonResponse({ status: "processing" }));
		vi.stubGlobal("fetch", fetchMock);

		await uploadCaseDevVaultFile(createContext(cwd), {
			vaultId: "vault-1",
			filePath,
			name: "note.md",
			contentType: "text/markdown",
		});

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
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"https://s3.test/upload",
			expect.objectContaining({
				method: "PUT",
				headers: { "Content-Type": "text/markdown" },
			}),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			3,
			"https://preview.api.case.dev/vault/vault-1/upload/obj-1/confirm",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ success: true, sizeBytes: 7, etag: '"abc"' }),
			}),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			4,
			"https://preview.api.case.dev/vault/vault-1/ingest/obj-1",
			expect.objectContaining({ method: "POST" }),
		);
	});
});
