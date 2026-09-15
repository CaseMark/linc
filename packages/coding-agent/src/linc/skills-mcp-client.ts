import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { parseFrontmatter } from "../utils/frontmatter.ts";

const EXTENSION = "io.modelcontextprotocol/skills";
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_SKILL_BYTES = 16 * 1024 * 1024;
const MAX_RESOURCES = 512;

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

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
type JsonObject = Record<string, unknown>;

function record(value: unknown): JsonObject {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid MCP response object");
	return value as JsonObject;
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
		if (total > MAX_SKILL_BYTES) throw new Error("MCP skill exceeds the pilot size limit");
		return { uri: resource.uri, digest: resource.digest, size: resource.size };
	});
	if (!seen.has(requestedUri)) throw new Error("MCP skill manifest omits SKILL.md");
	return { uri: requestedUri, frontmatter, resources };
}

export class CaseDevSkillsMcpClient {
	private readonly endpoint: string;
	private readonly apiKey: string;
	private readonly fetcher: Fetcher;
	private nextId = 0;
	private protocolVersion = "2025-03-26";
	private sessionId: string | null = null;
	private initialization: Promise<void> | null = null;

	constructor(options: { endpoint: string; apiKey: string; fetcher?: Fetcher }) {
		const endpoint = new URL(options.endpoint);
		if (
			endpoint.protocol !== "https:" ||
			endpoint.username ||
			endpoint.password ||
			endpoint.search ||
			endpoint.hash ||
			endpoint.pathname !== "/mcp" ||
			endpoint.hostname === "api.case.dev"
		) {
			throw new Error(
				"Use an explicit non-production HTTPS Case.dev MCP endpoint without credentials or query parameters",
			);
		}
		if (!options.apiKey.trim()) throw new Error("Missing Case.dev runtime API key");
		this.endpoint = endpoint.toString();
		this.apiKey = options.apiKey;
		this.fetcher = options.fetcher ?? fetch;
	}

	private async send(
		method: string,
		params: JsonObject,
		signal?: AbortSignal,
		notification = false,
	): Promise<JsonObject> {
		const id = notification ? undefined : ++this.nextId;
		const combinedSignal = signal
			? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
			: AbortSignal.timeout(15_000);
		const response = await this.fetcher(this.endpoint, {
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
			throw new Error("Case.dev MCP requires a JSON response for this pilot");
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
				if (bytes > MAX_RESPONSE_BYTES) throw new Error("Case.dev MCP response exceeds the pilot limit");
				chunks.push(chunk.value);
			}
		} finally {
			await reader.cancel();
		}
		const envelope = record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
		if (envelope.jsonrpc !== "2.0" || envelope.id !== id) throw new Error("Mismatched Case.dev MCP response");
		if (envelope.error) throw new Error(`Case.dev MCP ${method} returned an error`);
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
						clientInfo: { name: "linc-skills-pilot", version: "0.1.0" },
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
			if (page.skills.some((entry) => entry.uri.startsWith("skill://case.dev/public/")) || !page.nextCursor) {
				return this.getSkill(`skill://case.dev/public/${slug}/SKILL.md`, signal);
			}
			cursor = page.nextCursor;
		}
		throw new Error("Case.dev org skill listing exceeds the pilot page limit");
	}

	async readResource(entry: McpSkillEntry, uri: string, signal?: AbortSignal): Promise<string> {
		const expected = entry.resources.find((resource) => resource.uri === uri);
		if (!expected) throw new Error("Resource absent from the held skill manifest");
		await this.initialize(signal);
		const result = await this.send("resources/read", { uri }, signal);
		if (!Array.isArray(result.contents) || result.contents.length !== 1)
			throw new Error("Invalid Case.dev resource response");
		const content = record(result.contents[0]);
		if (content.uri !== uri || typeof content.text !== "string" || content.blob !== undefined) {
			throw new Error("Case.dev returned a different or non-text resource");
		}
		const bytes = Buffer.from(content.text, "utf8");
		const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
		if (bytes.length !== expected.size || digest !== expected.digest) {
			throw new Error("Case.dev skill resource changed during this run; discard it and reapprove the new manifest");
		}
		if (uri === entry.uri && !isDeepStrictEqual(parseFrontmatter(content.text).frontmatter, entry.frontmatter)) {
			throw new Error("Case.dev SKILL.md frontmatter differs from its held entry");
		}
		return content.text;
	}
}
