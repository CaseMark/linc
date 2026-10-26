import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { parseFrontmatter } from "../utils/frontmatter.ts";

const EXTENSION = "io.modelcontextprotocol/skills";
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_SKILL_BYTES = 16 * 1024 * 1024;
const MAX_BINARY_BYTES = 3 * 1024 * 1024;
const MAX_MIME_TYPE_BYTES = 256;
const MAX_RESOURCES = 512;
const MAX_ERROR_MESSAGE_LENGTH = 200;

export interface McpSkillResource {
	uri: string;
	digest: string;
	size: number;
}

export interface McpSkillEntry {
	uri: string;
	frontmatter: Record<string, unknown>;
	resources: McpSkillResource[];
}

export type McpSkillContent = { kind: "text"; text: string } | { kind: "blob"; bytes: Buffer; mimeType: string };

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const DEFAULT_RETRY_DELAYS_MS = [500, 1500];
const MAX_RETRY_DELAY_MS = 5_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(signal.reason);
			},
			{ once: true },
		);
	});
}
type JsonObject = Record<string, unknown>;

function record(value: unknown): JsonObject {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid MCP response object");
	return value as JsonObject;
}

function sanitizedErrorMessage(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const message = value.replace(/[\x00-\x1f\x7f]+/g, " ").trim();
	return message ? message.slice(0, MAX_ERROR_MESSAGE_LENGTH) : undefined;
}

function checkSkillUri(uri: string): void {
	if (!uri.startsWith("skill://case.dev/") || /[?#@\\]/.test(uri)) throw new Error("Invalid Case.dev skill URI");
	for (const segment of uri.slice("skill://case.dev/".length).split("/")) {
		let decoded: string;
		try {
			decoded = decodeURIComponent(segment);
		} catch {
			throw new Error("Invalid Case.dev skill URI encoding");
		}
		if (
			!decoded ||
			decoded === "." ||
			decoded === ".." ||
			/[/\\\x00-\x1f]/.test(decoded) ||
			encodeURIComponent(decoded) !== segment
		) {
			throw new Error("Invalid Case.dev skill URI segment");
		}
	}
}

function skillRoot(uri: string): string {
	checkSkillUri(uri);
	if (!uri.endsWith("/SKILL.md")) throw new Error("Expected a Case.dev SKILL.md URI");
	return uri.slice(0, -"/SKILL.md".length);
}

function validateEntry(value: unknown, requestedUri: string): McpSkillEntry {
	const candidate = record(value);
	if (candidate.uri !== requestedUri) throw new Error("MCP returned a different skill URI");
	const root = skillRoot(requestedUri);
	const frontmatter = record(candidate.frontmatter);
	const name = root.split("/").at(-1);
	if (frontmatter.name !== name || typeof frontmatter.description !== "string" || !frontmatter.description.trim()) {
		throw new Error("Invalid MCP skill frontmatter");
	}
	if (
		!Array.isArray(candidate.resources) ||
		candidate.resources.length === 0 ||
		candidate.resources.length > MAX_RESOURCES
	) {
		throw new Error("MCP skill requires a bounded static manifest");
	}
	const seen = new Set<string>();
	let total = 0;
	const resources = candidate.resources.map((item) => {
		const resource = record(item);
		if (typeof resource.uri !== "string") throw new Error("Invalid MCP skill resource URI");
		checkSkillUri(resource.uri);
		if (
			!resource.uri.startsWith(`${root}/`) ||
			seen.has(resource.uri) ||
			typeof resource.digest !== "string" ||
			!/^sha256:[a-f0-9]{64}$/.test(resource.digest) ||
			typeof resource.size !== "number" ||
			!Number.isSafeInteger(resource.size) ||
			resource.size < 0
		) {
			throw new Error("Invalid MCP skill manifest");
		}
		seen.add(resource.uri);
		total += resource.size;
		if (total > MAX_SKILL_BYTES) throw new Error("MCP skill exceeds the 16 MiB size limit");
		return { uri: resource.uri, digest: resource.digest, size: resource.size };
	});
	if (!seen.has(requestedUri)) throw new Error("MCP skill manifest omits SKILL.md");
	return { uri: requestedUri, frontmatter, resources };
}

export function getMcpSkillManifestDigest(entry: McpSkillEntry): string {
	const manifest = {
		uri: entry.uri,
		resources: [...entry.resources]
			.sort((left, right) => (left.uri < right.uri ? -1 : left.uri > right.uri ? 1 : 0))
			.map(({ uri, digest, size }) => ({ uri, digest, size })),
	};
	return `sha256:${createHash("sha256").update(JSON.stringify(manifest)).digest("hex")}`;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function validateCaseDevSkillsMcpEndpoint(value: string): string {
	let endpoint: URL;
	try {
		endpoint = new URL(value);
	} catch {
		throw new Error("Use an HTTPS Case.dev MCP endpoint without credentials or query parameters");
	}
	const secure =
		endpoint.protocol === "https:" || (endpoint.protocol === "http:" && LOOPBACK_HOSTS.has(endpoint.hostname));
	if (
		!secure ||
		endpoint.username ||
		endpoint.password ||
		endpoint.search ||
		endpoint.hash ||
		endpoint.pathname !== "/mcp"
	) {
		throw new Error("Use an HTTPS Case.dev MCP endpoint without credentials or query parameters");
	}
	return endpoint.toString();
}

/**
 * The Case.dev MCP endpoint for this runtime: LINC_MCP_SKILLS_ENDPOINT when set,
 * otherwise `/mcp` on the runtime Case.dev API origin. The endpoint must share
 * that origin so the runtime key is never sent to another environment.
 */
export function resolveCaseDevSkillsMcpEndpoint(env: NodeJS.ProcessEnv = process.env): string {
	const runtimeBaseUrl = env.CASEDEV_BASE_URL || env.CASE_API_URL;
	let runtimeOrigin: string;
	try {
		runtimeOrigin = runtimeBaseUrl ? new URL(runtimeBaseUrl).origin : "";
	} catch {
		throw new Error("The runtime Case.dev API URL is invalid");
	}
	if (!runtimeOrigin) throw new Error("Case.dev skills require CASEDEV_BASE_URL");
	const endpoint = validateCaseDevSkillsMcpEndpoint(env.LINC_MCP_SKILLS_ENDPOINT || `${runtimeOrigin}/mcp`);
	if (new URL(endpoint).origin !== runtimeOrigin) {
		throw new Error("Case.dev MCP endpoint must match the runtime Case.dev API origin");
	}
	return endpoint;
}

/** Path of a manifest resource relative to its skill root, e.g. `scripts/run.py`. */
export function getMcpSkillResourcePath(entry: McpSkillEntry, uri: string): string {
	const root = skillRoot(entry.uri);
	if (!uri.startsWith(`${root}/`)) throw new Error("Resource outside the skill root");
	checkSkillUri(uri);
	return uri
		.slice(root.length + 1)
		.split("/")
		.map((segment) => decodeURIComponent(segment))
		.join("/");
}

export class CaseDevSkillsMcpClient {
	private readonly endpoint: string;
	private readonly apiKey: string;
	private readonly fetcher: Fetcher;
	private readonly retryDelaysMs: number[];
	private nextId = 0;
	private protocolVersion = "2025-03-26";
	private sessionId: string | null = null;
	private initialization: Promise<void> | null = null;

	constructor(options: { endpoint: string; apiKey: string; fetcher?: Fetcher; retryDelaysMs?: number[] }) {
		if (!options.apiKey.trim()) throw new Error("Missing Case.dev runtime API key");
		this.endpoint = validateCaseDevSkillsMcpEndpoint(options.endpoint);
		this.apiKey = options.apiKey;
		this.fetcher = options.fetcher ?? fetch;
		this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
	}

	private async post(id: number | undefined, method: string, params: JsonObject, signal?: AbortSignal) {
		for (let attempt = 0; ; attempt++) {
			const combinedSignal = signal
				? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
				: AbortSignal.timeout(15_000);
			let response: Response;
			try {
				response = await this.fetcher(this.endpoint, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
						"Content-Type": "application/json",
						Accept: "application/json",
						"MCP-Protocol-Version": this.protocolVersion,
						...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
					},
					body: JSON.stringify({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method, params }),
					redirect: "error",
					signal: combinedSignal,
				});
			} catch (error) {
				signal?.throwIfAborted();
				if (attempt >= this.retryDelaysMs.length) throw error;
				await sleep(this.retryDelaysMs[attempt], signal);
				continue;
			}
			if (response.ok || !RETRYABLE_STATUSES.has(response.status) || attempt >= this.retryDelaysMs.length) {
				return response;
			}
			const retryAfterSeconds = Number(response.headers.get("retry-after"));
			await response.body?.cancel();
			const delay =
				Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
					? Math.min(retryAfterSeconds * 1000, MAX_RETRY_DELAY_MS)
					: this.retryDelaysMs[attempt];
			await sleep(delay, signal);
		}
	}

	private async send(
		method: string,
		params: JsonObject,
		signal?: AbortSignal,
		notification = false,
	): Promise<JsonObject> {
		const id = notification ? undefined : ++this.nextId;
		const response = await this.post(id, method, params, signal);
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error(`Case.dev MCP ${method} failed with HTTP ${response.status}`);
		}
		if (method === "initialize") this.sessionId = response.headers.get("mcp-session-id");
		if (notification) {
			await response.body?.cancel();
			return {};
		}
		if (!response.headers.get("content-type")?.includes("application/json")) {
			await response.body?.cancel();
			throw new Error("Case.dev MCP returned a non-JSON response");
		}
		const reader = response.body?.getReader();
		if (!reader) throw new Error("Empty Case.dev MCP response");
		const chunks: Uint8Array[] = [];
		let bytes = 0;
		try {
			for (;;) {
				const chunk = await reader.read();
				if (chunk.done) break;
				bytes += chunk.value.byteLength;
				if (bytes > MAX_RESPONSE_BYTES) throw new Error("Case.dev MCP response exceeds the 8 MiB limit");
				chunks.push(chunk.value);
			}
		} finally {
			await reader.cancel();
		}
		let envelope: JsonObject;
		try {
			envelope = record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
		} catch {
			throw new Error(`Case.dev MCP ${method} returned invalid JSON`);
		}
		if (envelope.jsonrpc !== "2.0" || envelope.id !== id) throw new Error("Mismatched Case.dev MCP response");
		if (envelope.error) {
			const error = record(envelope.error);
			const code =
				typeof error.code === "number" || typeof error.code === "string"
					? ` ${String(error.code).slice(0, 32)}`
					: "";
			const message = sanitizedErrorMessage(error.message);
			throw new Error(`Case.dev MCP ${method} error${code}${message ? `: ${message}` : ""}`);
		}
		return record(envelope.result);
	}

	async initialize(signal?: AbortSignal): Promise<void> {
		if (!this.initialization) {
			this.initialization = (async () => {
				const result = await this.send(
					"initialize",
					{
						protocolVersion: this.protocolVersion,
						capabilities: { extensions: { [EXTENSION]: {} } },
						clientInfo: { name: "linc-skills", version: "1.0.0" },
					},
					signal,
				);
				if (typeof result.protocolVersion !== "string") throw new Error("Missing Case.dev MCP protocol version");
				this.protocolVersion = result.protocolVersion;
				const capabilities = record(result.capabilities);
				if (!capabilities.resources || !record(capabilities.extensions)[EXTENSION]) {
					throw new Error("Case.dev MCP does not advertise the Skills extension");
				}
				await this.send("notifications/initialized", {}, signal, true);
			})();
			this.initialization.catch(() => {
				this.initialization = null;
			});
		}
		await this.initialization;
	}

	async getSkill(uri: string, signal?: AbortSignal): Promise<McpSkillEntry> {
		skillRoot(uri);
		await this.initialize(signal);
		const result = await this.send("skills/get", { uri }, signal);
		if (result.resultType !== "complete") throw new Error("Case.dev MCP returned an incomplete skill");
		return validateEntry(result.skill, uri);
	}

	async listSkills(cursor?: string, signal?: AbortSignal): Promise<{ skills: McpSkillEntry[]; nextCursor?: string }> {
		if (cursor !== undefined && (cursor.length === 0 || cursor.length > 1024)) {
			throw new Error("Invalid Case.dev skill cursor");
		}
		await this.initialize(signal);
		const result = await this.send("skills/list", cursor ? { cursor } : {}, signal);
		if (result.resultType !== "complete" || !Array.isArray(result.skills) || result.skills.length > 100) {
			throw new Error("Case.dev MCP returned an invalid skill listing");
		}
		if (
			result.nextCursor !== undefined &&
			(typeof result.nextCursor !== "string" || result.nextCursor.length === 0 || result.nextCursor.length > 1024)
		) {
			throw new Error("Case.dev MCP returned an invalid skill cursor");
		}
		return {
			skills: result.skills.map((value) => {
				const entry = record(value);
				if (typeof entry.uri !== "string") throw new Error("Case.dev MCP returned an invalid skill entry");
				return validateEntry(entry, entry.uri);
			}),
			...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
		};
	}

	async resolveSkillSlug(slug: string, signal?: AbortSignal): Promise<McpSkillEntry> {
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 64) {
			throw new Error("Invalid Case.dev skill slug");
		}
		let cursor: string | undefined;
		for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
			const page = await this.listSkills(cursor, signal);
			const privateMatch = page.skills.find(
				(entry) => entry.uri.startsWith("skill://case.dev/org/") && entry.frontmatter.name === slug,
			);
			if (privateMatch) return privateMatch;
			const publicMatch = page.skills.find(
				(entry) => entry.uri.startsWith("skill://case.dev/public/") && entry.frontmatter.name === slug,
			);
			if (publicMatch) return publicMatch;
			// Case.dev enumerates every org-private page before the public catalog.
			// Once a public entry appears, private precedence is settled. Use the
			// required skills/get method for the selected public URI instead of
			// walking a catalog that may be intentionally partial or very large.
			if (page.skills.some((entry) => entry.uri.startsWith("skill://case.dev/public/"))) {
				return this.getSkill(`skill://case.dev/public/${slug}/SKILL.md`, signal);
			}
			if (!page.nextCursor) return this.getSkill(`skill://case.dev/public/${slug}/SKILL.md`, signal);
			cursor = page.nextCursor;
		}
		throw new Error("Case.dev org skill listing exceeds 100 pages");
	}

	async readResource(entry: McpSkillEntry, uri: string, signal?: AbortSignal): Promise<string> {
		const content = await this.readResourceContent(entry, uri, signal);
		if (content.kind !== "text") throw new Error("Expected a text skill resource");
		return content.text;
	}

	async readResourceContent(entry: McpSkillEntry, uri: string, signal?: AbortSignal): Promise<McpSkillContent> {
		const expected = entry.resources.find((resource) => resource.uri === uri);
		if (!expected) throw new Error("Resource absent from the held skill manifest");
		await this.initialize(signal);
		const result = await this.send("resources/read", { uri }, signal);
		if (!Array.isArray(result.contents) || result.contents.length !== 1)
			throw new Error("Invalid Case.dev resource response");
		const content = record(result.contents[0]);
		if (content.uri !== uri) throw new Error("Case.dev returned a different resource");
		let decoded: McpSkillContent;
		if (typeof content.text === "string" && content.blob === undefined) {
			decoded = { kind: "text", text: content.text };
		} else if (
			typeof content.blob === "string" &&
			content.text === undefined &&
			uri !== entry.uri &&
			content.blob.length <= 4 * Math.ceil(MAX_BINARY_BYTES / 3) &&
			typeof content.mimeType === "string" &&
			Buffer.byteLength(content.mimeType, "utf8") <= MAX_MIME_TYPE_BYTES &&
			/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;[^\r\n\x00]*)?$/i.test(content.mimeType)
		) {
			const bytes = Buffer.from(content.blob, "base64");
			if (bytes.length > MAX_BINARY_BYTES || bytes.toString("base64") !== content.blob) {
				throw new Error("Invalid Case.dev binary resource encoding");
			}
			decoded = { kind: "blob", bytes, mimeType: content.mimeType };
		} else {
			throw new Error("Invalid Case.dev text or binary resource");
		}
		const bytes = decoded.kind === "blob" ? decoded.bytes : Buffer.from(decoded.text, "utf8");
		const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
		if (bytes.length !== expected.size || digest !== expected.digest) {
			throw new Error("Case.dev skill resource changed while loading; load the skill again");
		}
		if (
			uri === entry.uri &&
			decoded.kind === "text" &&
			!isDeepStrictEqual(parseFrontmatter(decoded.text).frontmatter, entry.frontmatter)
		) {
			throw new Error("Case.dev SKILL.md frontmatter differs from its held entry");
		}
		return decoded;
	}
}
