import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { ExtensionContext } from "../core/extensions/types.ts";
import { getCaseDevApiKey } from "./casedev-cli.ts";

const DEFAULT_CASEDEV_API_BASE_URL = "https://api.case.dev";

export interface CaseDevVaultRecord {
	id: string;
	name: string;
	totalObjects?: number;
}

export interface CaseDevVaultObjectRecord {
	id: string;
	filename?: string;
	name?: string;
	path?: string;
	contentType?: string;
	sizeBytes?: number;
	ingestionStatus?: string;
}

export interface CaseDevVaultUploadParams {
	vaultId: string;
	filePath: string;
	name?: string;
	contentType?: string;
	path?: string;
	ingest?: boolean;
}

export interface CaseDevVaultDownloadParams {
	vaultId: string;
	objectId: string;
	outDir: string;
	filename?: string;
}

export interface CaseDevVaultReadTextParams {
	vaultId: string;
	objectId: string;
	outDir: string;
	filename?: string;
}

export const CASEDEV_VAULT_TEXT_MAX_CHARS = 10_000;
export const CASEDEV_VAULT_TEXT_TRUNCATION_WARNING =
	"this document is too long to view in full. Use targeted vault searches to retrieve more context";

export interface CaseDevVaultSearchParams {
	query: string;
	method?: "hybrid" | "global" | "entity" | "fast" | "vector" | "graph" | "local";
	limit?: number;
	objectIds?: string[];
}

function getCaseDevApiBaseUrl(): string {
	return (
		process.env.CASEDEV_API_BASE_URL ||
		process.env.CASEDEV_BASE_URL ||
		process.env.CASE_API_URL ||
		DEFAULT_CASEDEV_API_BASE_URL
	).replace(/\/+$/, "");
}

function getCaseDevVercelProtectionHeaders(): Record<string, string> {
	const bypass = process.env.CASEDEV_VERCEL_PROTECTION_BYPASS;
	return bypass ? { "x-vercel-protection-bypass": bypass } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readVaultRecord(value: unknown): CaseDevVaultRecord | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.id !== "string" || value.id.length === 0) return undefined;
	if (typeof value.name !== "string" || value.name.length === 0) return undefined;
	return {
		id: value.id,
		name: value.name,
		totalObjects: typeof value.totalObjects === "number" ? value.totalObjects : undefined,
	};
}

function readVaultObjectRecord(value: unknown): CaseDevVaultObjectRecord | undefined {
	if (!isRecord(value)) return undefined;
	const id = typeof value.id === "string" ? value.id : typeof value.objectId === "string" ? value.objectId : undefined;
	if (!id) return undefined;
	return {
		id,
		filename: typeof value.filename === "string" ? value.filename : undefined,
		name: typeof value.name === "string" ? value.name : undefined,
		contentType: typeof value.contentType === "string" ? value.contentType : undefined,
		sizeBytes: typeof value.sizeBytes === "number" ? value.sizeBytes : undefined,
		ingestionStatus: typeof value.ingestionStatus === "string" ? value.ingestionStatus : undefined,
		path:
			typeof value.path === "string"
				? value.path
				: typeof value.relativePath === "string"
					? value.relativePath
					: undefined,
	};
}

function collectVaultObjectRecords(value: unknown): CaseDevVaultObjectRecord[] {
	if (Array.isArray(value)) {
		return value
			.map(readVaultObjectRecord)
			.filter((record): record is CaseDevVaultObjectRecord => record !== undefined);
	}
	if (!isRecord(value)) return [];
	for (const key of ["objects", "items", "data", "results"]) {
		const records = collectVaultObjectRecords(value[key]);
		if (records.length > 0) return records;
	}
	const record = readVaultObjectRecord(value);
	return record ? [record] : [];
}

async function readResponseBody(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text) return {};
	const contentType = response.headers.get("content-type") ?? "";
	if (contentType.includes("application/json")) {
		return JSON.parse(text) as unknown;
	}
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
}

function stringifyApiError(data: unknown): string {
	if (typeof data === "string") return data;
	if (isRecord(data)) {
		const message = data.error ?? data.message;
		if (typeof message === "string" && message.length > 0) return message;
	}
	return JSON.stringify(data);
}

export async function caseDevApiRequest<T = unknown>(
	ctx: ExtensionContext,
	method: string,
	path: string,
	options?: {
		body?: unknown;
		signal?: AbortSignal;
	},
): Promise<T> {
	const apiKey = await getCaseDevApiKey(ctx);
	const response = await fetch(`${getCaseDevApiBaseUrl()}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${apiKey}`,
			...getCaseDevVercelProtectionHeaders(),
			...(options?.body === undefined ? {} : { "Content-Type": "application/json" }),
		},
		body: options?.body === undefined ? undefined : JSON.stringify(options.body),
		signal: options?.signal,
	});
	const data = await readResponseBody(response);
	if (!response.ok) {
		throw new Error(`Case.dev API ${method} ${path} failed (${response.status}): ${stringifyApiError(data)}`);
	}
	return data as T;
}

export async function listCaseDevVaults(ctx: ExtensionContext): Promise<CaseDevVaultRecord[]> {
	const data = await caseDevApiRequest(ctx, "GET", "/vault", { signal: ctx.signal });
	if (!isRecord(data) || !Array.isArray(data.vaults)) {
		throw new Error("Case.dev returned invalid vault list metadata.");
	}
	return data.vaults.map(readVaultRecord).filter((vault): vault is CaseDevVaultRecord => vault !== undefined);
}

export async function getCaseDevVault(ctx: ExtensionContext, vaultId: string): Promise<CaseDevVaultRecord> {
	const data = await caseDevApiRequest(ctx, "GET", `/vault/${encodeURIComponent(vaultId)}`, { signal: ctx.signal });
	const vault = readVaultRecord(data);
	if (!vault) {
		throw new Error("Case.dev returned invalid vault metadata.");
	}
	return vault;
}

export async function listCaseDevVaultObjects(
	ctx: ExtensionContext,
	vaultId: string,
): Promise<CaseDevVaultObjectRecord[]> {
	const data = await caseDevApiRequest(ctx, "GET", `/vault/${encodeURIComponent(vaultId)}/objects`, {
		signal: ctx.signal,
	});
	return collectVaultObjectRecords(data);
}

export async function searchCaseDevVault(
	ctx: ExtensionContext,
	vaultId: string,
	params: CaseDevVaultSearchParams,
): Promise<unknown> {
	const body: Record<string, unknown> = {
		query: params.query,
	};
	if (params.method) body.method = params.method;
	if (params.limit !== undefined) body.topK = params.limit;
	if (params.objectIds && params.objectIds.length > 0) {
		body.filters = { object_id: params.objectIds.length === 1 ? params.objectIds[0] : params.objectIds };
	}
	return caseDevApiRequest(ctx, "POST", `/vault/${encodeURIComponent(vaultId)}/search`, {
		body,
		signal: ctx.signal,
	});
}

function safeOutputPath(outDir: string, filename: string): string {
	const root = resolve(outDir);
	const cleanName =
		basename(filename)
			.replace(/[\r\n]/g, "")
			.trim() || "download";
	const outputPath = resolve(root, cleanName);
	const rel = relative(root, outputPath);
	if (rel === "" || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\")) {
		throw new Error(`Unsafe download filename: ${filename}`);
	}
	return outputPath;
}

export async function downloadCaseDevVaultObject(
	ctx: ExtensionContext,
	params: CaseDevVaultDownloadParams,
): Promise<{ objectId: string; path: string; bytes: number }> {
	const apiKey = await getCaseDevApiKey(ctx);
	const response = await fetch(
		`${getCaseDevApiBaseUrl()}/vault/${encodeURIComponent(params.vaultId)}/objects/${encodeURIComponent(params.objectId)}/download`,
		{
			method: "GET",
			headers: { Authorization: `Bearer ${apiKey}`, ...getCaseDevVercelProtectionHeaders() },
			signal: ctx.signal,
		},
	);
	if (!response.ok) {
		const body = await readResponseBody(response).catch(() => "");
		throw new Error(
			`Case.dev API GET /vault/${params.vaultId}/objects/${params.objectId}/download failed (${response.status}): ${stringifyApiError(body)}`,
		);
	}
	if (!response.body) {
		throw new Error(
			`Case.dev API GET /vault/${params.vaultId}/objects/${params.objectId}/download returned an empty body`,
		);
	}
	await mkdir(params.outDir, { recursive: true });
	const outputPath = safeOutputPath(params.outDir, params.filename ?? params.objectId);
	// Stream to disk: buffering the whole object holds the full file in memory
	// and gets the runtime OOM-killed on multi-GB originals (CD-1284).
	await pipeline(Readable.fromWeb(response.body as WebReadableStream<Uint8Array>), createWriteStream(outputPath));
	const stats = await stat(outputPath);
	return { objectId: params.objectId, path: outputPath, bytes: stats.size };
}

export async function readCaseDevVaultObjectText(
	ctx: ExtensionContext,
	params: CaseDevVaultReadTextParams,
): Promise<{ objectId: string; path: string; chars: number; pageMarkers: number; note: string }> {
	const payload = await caseDevApiRequest<{ text?: unknown; metadata?: { filename?: unknown } }>(
		ctx,
		"GET",
		`/vault/${encodeURIComponent(params.vaultId)}/objects/${encodeURIComponent(params.objectId)}/text`,
		{ signal: ctx.signal },
	);
	const text = typeof payload?.text === "string" ? payload.text : "";
	if (!text) {
		throw new Error(
			`Case.dev returned no extracted text for object ${params.objectId}; the object may not be ingested yet.`,
		);
	}
	const metadataFilename = typeof payload?.metadata?.filename === "string" ? payload.metadata.filename : undefined;
	const baseName = params.filename ?? metadataFilename ?? params.objectId;
	const filename = baseName.endsWith(".txt") ? baseName : `${baseName}.txt`;
	await mkdir(params.outDir, { recursive: true });
	const outputPath = safeOutputPath(params.outDir, filename);
	const truncated = text.length > CASEDEV_VAULT_TEXT_MAX_CHARS;
	const visibleTextLimit = truncated
		? CASEDEV_VAULT_TEXT_MAX_CHARS - CASEDEV_VAULT_TEXT_TRUNCATION_WARNING.length - 2
		: CASEDEV_VAULT_TEXT_MAX_CHARS;
	const visibleText = text.slice(0, visibleTextLimit);
	const output = truncated ? `${CASEDEV_VAULT_TEXT_TRUNCATION_WARNING}\n\n${visibleText}` : visibleText;
	await writeFile(outputPath, output, "utf8");
	const pageMarkers = (visibleText.match(/^--- Page \d+ ---$/gm) ?? []).length;
	return {
		objectId: params.objectId,
		path: outputPath,
		chars: text.length,
		pageMarkers,
		note: truncated
			? CASEDEV_VAULT_TEXT_TRUNCATION_WARNING
			: pageMarkers > 0
				? "Text contains --- Page N --- markers; cite findings by those page numbers."
				: "This document has no page markers; cite findings by section or heading.",
	};
}

export async function uploadCaseDevVaultFile(
	ctx: ExtensionContext,
	params: CaseDevVaultUploadParams,
): Promise<unknown> {
	const file = await readFile(params.filePath);
	const fileStats = await stat(params.filePath);
	const contentType = params.contentType ?? "application/octet-stream";
	const filename = params.name ?? basename(params.filePath);
	const vaultPath = `/vault/${encodeURIComponent(params.vaultId)}`;
	const upload = await caseDevApiRequest<Record<string, unknown>>(ctx, "POST", `${vaultPath}/upload`, {
		body: {
			filename,
			contentType,
			sizeBytes: fileStats.size,
			auto_index: params.ingest !== false,
			...(params.path ? { path: params.path } : {}),
		},
		signal: ctx.signal,
	});
	const uploadUrl =
		typeof upload.uploadUrl === "string"
			? upload.uploadUrl
			: typeof upload.presignedUrl === "string"
				? upload.presignedUrl
				: typeof upload.url === "string"
					? upload.url
					: undefined;
	const objectId =
		typeof upload.objectId === "string"
			? upload.objectId
			: typeof upload.object_id === "string"
				? upload.object_id
				: typeof upload.id === "string"
					? upload.id
					: undefined;
	if (!uploadUrl || !objectId) {
		throw new Error("Case.dev returned an invalid vault upload response.");
	}

	const uploadResponse = await fetch(uploadUrl, {
		method: "PUT",
		headers: { "Content-Type": contentType },
		body: new Uint8Array(file),
		signal: ctx.signal,
	});
	if (!uploadResponse.ok) {
		await caseDevApiRequest(ctx, "POST", `${vaultPath}/upload/${encodeURIComponent(objectId)}/confirm`, {
			body: {
				success: false,
				errorCode: `HTTP_${uploadResponse.status}`,
				errorMessage: `S3 upload failed with status ${uploadResponse.status}`,
			},
			signal: ctx.signal,
		}).catch(() => {});
		throw new Error(`S3 upload failed with status ${uploadResponse.status}`);
	}

	const confirm = await caseDevApiRequest(ctx, "POST", `${vaultPath}/upload/${encodeURIComponent(objectId)}/confirm`, {
		body: {
			success: true,
			sizeBytes: fileStats.size,
			etag: uploadResponse.headers.get("etag") ?? undefined,
		},
		signal: ctx.signal,
	});
	const ingest =
		params.ingest === false || typeof upload.next_step !== "string"
			? undefined
			: await caseDevApiRequest(ctx, "POST", `${vaultPath}/ingest/${encodeURIComponent(objectId)}`, {
					signal: ctx.signal,
				});

	return {
		vaultId: params.vaultId,
		objectId,
		filename,
		upload,
		confirm,
		ingest,
	};
}
