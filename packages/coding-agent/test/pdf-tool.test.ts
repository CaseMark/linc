import { createHash } from "node:crypto";
import { link, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { createPdfTool } from "../src/linc/pdf-tool.ts";

const directories: string[] = [];
const created = vi.fn();
const tool = createPdfTool(created);
type Input = Parameters<typeof tool.execute>[1];
const input: Input = { filename: "summary.pdf", blocks: [{ type: "paragraph", text: "Synthetic text" }] };
const pdf = Buffer.from("%PDF-1.3\nSynthetic formatter fixture\n%%EOF\n");
const fetcher = vi.fn<(url: string | URL, init: RequestInit) => Promise<Response>>(
	async () => new Response(pdf, { headers: { "Content-Type": "application/pdf" } }),
);

async function workspace() {
	const cwd = await mkdtemp(join(tmpdir(), "linc-pdf-test-"));
	directories.push(cwd);
	return {
		cwd,
		modelRegistry: { authStorage: { getApiKey: vi.fn(async () => "fixture-org-key") } },
	} as unknown as ExtensionContext;
}

beforeEach(() => {
	created.mockClear();
	fetcher.mockClear();
	fetcher.mockImplementation(
		async () =>
			new Response(pdf, {
				headers: { "Content-Type": "application/pdf", "X-Case-Document-Features": "pdf-tables-v1" },
			}),
	);
	vi.stubGlobal("fetch", fetcher);
	vi.stubEnv("LINC_MCP_SKILLS_ENDPOINT", "https://preview.api.case.dev/mcp");
	vi.stubEnv("CASEDEV_BASE_URL", "https://preview.api.case.dev");
	vi.stubEnv("LINC_MCP_SKILLS_ALLOW_PRODUCTION", "0");
});

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("bounded native PDF tool", () => {
	test.each([undefined, "pdf-tables-v10", "other-feature"])(
		"refuses table output from older formatters (%s), without breaking paragraph output",
		async (features) => {
			fetcher.mockImplementation(
				async () =>
					new Response(pdf, {
						headers: {
							"Content-Type": "application/pdf",
							...(features ? { "X-Case-Document-Features": features } : {}),
						},
					}),
			);
			const ctx = await workspace();
			await expect(
				tool.execute(
					"table",
					{ filename: "table.pdf", blocks: [{ type: "table", rows: [["Header"], ["Value"]] }] },
					undefined,
					undefined,
					ctx,
				),
			).rejects.toThrow("does not advertise PDF table support");
			expect(await readdir(ctx.cwd)).toEqual([]);
			expect(created).not.toHaveBeenCalled();
			expect(fetcher).toHaveBeenCalledTimes(1);
			await tool.execute("paragraph", input, undefined, undefined, ctx);
			expect(created).toHaveBeenCalledOnce();
		},
	);
	test("uses existing auth without fallback, rejects a missing key, and allows explicitly approved production", async () => {
		const ctx = await workspace();
		vi.mocked(ctx.modelRegistry.authStorage.getApiKey).mockResolvedValueOnce(undefined);
		await expect(tool.execute("missing", input, undefined, undefined, ctx)).rejects.toThrow("No Case.dev API key");
		expect(ctx.modelRegistry.authStorage.getApiKey).toHaveBeenCalledWith("casedev", { includeFallback: false });
		expect(fetcher).not.toHaveBeenCalled();
		vi.stubEnv("LINC_MCP_SKILLS_ENDPOINT", "https://api.case.dev/mcp");
		vi.stubEnv("CASEDEV_BASE_URL", "https://api.case.dev");
		vi.stubEnv("LINC_MCP_SKILLS_ALLOW_PRODUCTION", "1");
		await tool.execute(
			"approved",
			{ ...input, blocks: [{ type: "paragraph", text: "José – reviewer’s note… €" }] },
			undefined,
			undefined,
			ctx,
		);
		expect(String(fetcher.mock.calls[0][0])).toBe("https://api.case.dev/format/v1/document");
	});
	test("posts only host-owned formatter syntax, authenticated without redirects, then writes verifiable bytes", async () => {
		const ctx = await workspace();
		const literal =
			"![image](https://example.invalid/a) <script>run()</script> & &#35; **bold** $(touch owned)\n    # injected";
		const result = await tool.execute(
			"pdf",
			{
				filename: "QA Summary.pdf",
				blocks: [
					{ type: "heading", level: 2, text: "Summary" },
					{ type: "paragraph", text: literal },
				],
			},
			undefined,
			undefined,
			ctx,
		);
		expect(fetcher).toHaveBeenCalledTimes(1);
		const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
		expect(url.toString()).toBe("https://preview.api.case.dev/format/v1/document");
		expect(new Headers(init.headers).get("authorization")).toBe("Bearer fixture-org-key");
		expect(init.redirect).toBe("error");
		expect(init.signal).toBeInstanceOf(AbortSignal);
		const body = JSON.parse(String(init.body));
		expect(body.input_format).toBe("md");
		expect(body.output_format).toBe("pdf");
		expect(body.content).toContain("## Summary\n\n&#33;&#91;image&#93;&#40;https&#58;&#47;&#47;");
		expect(body.content).toContain("&#38;&#35;35&#59;");
		expect(body.content).toContain("  \n&#32;&#32;&#32;&#32;&#35;&#32;injected");
		expect(body.content).not.toContain("![image]");
		expect(body.content).not.toContain("<script>");
		expect(Object.keys(body.options)).toEqual(["styles"]);
		const bytes = await readFile(result.details.filePath);
		expect(bytes).toEqual(pdf);
		expect(result.details).toMatchObject({
			contentType: "application/pdf",
			dataOnly: true,
			bytes: pdf.length,
			sha256: createHash("sha256").update(pdf).digest("hex"),
		});
		expect(created).toHaveBeenCalledExactlyOnceWith(result.details);
		expect(result.details).not.toHaveProperty("executionApproved");
		if (process.platform !== "win32") expect((await stat(result.details.filePath)).mode & 0o777).toBe(0o600);
	});

	test.each([
		"../x.pdf",
		"/tmp/x.pdf",
		"x/y.pdf",
		"x\\y.pdf",
		".hidden.pdf",
		"x.pdf\n",
		"x.pdf\r",
		"x.pdf\u2028",
		"x.py",
		"x.pdf\0",
	])("rejects unsafe filename %j before any request", async (filename) => {
		const ctx = await workspace();
		await expect(tool.execute("bad", { ...input, filename }, undefined, undefined, ctx)).rejects.toThrow("Invalid");
		expect(fetcher).not.toHaveBeenCalled();
		expect(await readdir(ctx.cwd)).toEqual([]);
	});

	test.each([
		"html",
		"script",
		"command",
		"template",
		"inputPath",
		"outputPath",
		"origin",
		"options",
		"images",
		"components",
	])("rejects caller-controlled %s", async (field) => {
		const ctx = await workspace();
		await expect(
			tool.execute("bad", { ...input, [field]: "untrusted" } as Input, undefined, undefined, ctx),
		).rejects.toThrow("Invalid");
		expect(fetcher).not.toHaveBeenCalled();
	});

	test("rejects malformed tables, unknown block fields, oversized and invalid text", async () => {
		const ctx = await workspace();
		for (const blocks of [
			[{ type: "table", rows: [] }],
			[{ type: "table", rows: [["Header"], ["ragged", "row"]] }],
			[{ type: "table", rows: [[""]] }],
			[{ type: "table", rows: [["Header"]], command: "run" }],
			[{ type: "table", rows: Array.from({ length: 101 }, () => ["x"]) }],
			[{ type: "table", rows: [Array.from({ length: 13 }, () => "x")] }],
			Array.from({ length: 4 }, () => ({
				type: "table",
				rows: Array.from({ length: 100 }, () => Array.from({ length: 12 }, () => "x")),
			})),
			[{ type: "paragraph", text: "text", html: "<img/>" }],
			[{ type: "paragraph", text: "\0" }],
			[{ type: "paragraph", text: "\ud800" }],
			[{ type: "paragraph", text: "Missing glyph: ⚖" }],
			[{ type: "paragraph", text: "Missing glyph: 東京" }],
			[{ type: "paragraph", text: " " }],
			[{ type: "heading", level: 4, text: "x" }],
			[{ type: "paragraph", text: "x".repeat(16_385) }],
			Array.from({ length: 257 }, () => ({ type: "paragraph", text: "x" })),
			Array.from({ length: 17 }, () => ({ type: "paragraph", text: "x".repeat(16_384) })),
			Array.from({ length: 9 }, () => ({ type: "paragraph", text: "é".repeat(16_384) })),
		]) {
			await expect(tool.execute("bad", { ...input, blocks } as Input, undefined, undefined, ctx)).rejects.toThrow();
		}
		expect(fetcher).not.toHaveBeenCalled();
	});

	test("emits only host-owned table syntax and preserves literal pipes, newlines and empty cells", async () => {
		const ctx = await workspace();
		await tool.execute(
			"table",
			{
				filename: "table.pdf",
				blocks: [
					{
						type: "table",
						rows: [
							["Item", "Amount"],
							["A | B\n![x](https://invalid)", ""],
							["Total", "$12"],
						],
					},
				],
			},
			undefined,
			undefined,
			ctx,
		);
		const body = JSON.parse(String(fetcher.mock.calls[0][1].body));
		expect(body.content).toBe(
			"| Item | Amount |\n| --- | --- |\n| A&#32;&#124;&#32;B&#10;&#33;&#91;x&#93;&#40;https&#58;&#47;&#47;invalid&#41; |  |\n| Total | &#36;12 |",
		);
		expect(created).toHaveBeenCalledOnce();
	});

	test.each([
		["https://other.invalid/mcp", "https://preview.api.case.dev", "0"],
		["https://api.case.dev/mcp", "https://api.case.dev", "0"],
		["http://preview.api.case.dev/mcp", "http://preview.api.case.dev", "0"],
		["https://user:password@preview.api.case.dev/mcp", "https://preview.api.case.dev", "0"],
		["https://preview.api.case.dev/mcp?token=x", "https://preview.api.case.dev", "0"],
	])("rejects unauthorized endpoint %s before reading credentials", async (endpoint, runtime, allow) => {
		vi.stubEnv("LINC_MCP_SKILLS_ENDPOINT", endpoint);
		vi.stubEnv("CASEDEV_BASE_URL", runtime);
		vi.stubEnv("LINC_MCP_SKILLS_ALLOW_PRODUCTION", allow);
		const ctx = await workspace();
		await expect(tool.execute("bad", input, undefined, undefined, ctx)).rejects.toThrow();
		expect(ctx.modelRegistry.authStorage.getApiKey).not.toHaveBeenCalled();
		expect(fetcher).not.toHaveBeenCalled();
	});

	test.each(["", "not-a-url", "://bad"])(
		"reports invalid runtime origin %j before reading credentials",
		async (runtime) => {
			vi.stubEnv("CASEDEV_BASE_URL", runtime);
			vi.stubEnv("CASE_API_URL", "");
			const ctx = await workspace();
			await expect(tool.execute("bad", input, undefined, undefined, ctx)).rejects.toThrow(
				"requires a valid runtime Case.dev API origin",
			);
			expect(ctx.modelRegistry.authStorage.getApiKey).not.toHaveBeenCalled();
			expect(fetcher).not.toHaveBeenCalled();
		},
	);

	test.each([401, 429, 500, 302])("does not retry HTTP %i or reflect the response body", async (status) => {
		fetcher.mockImplementation(async () => new Response("sensitive error body", { status }));
		const ctx = await workspace();
		await expect(tool.execute("bad", input, undefined, undefined, ctx)).rejects.toThrow(`HTTP ${status}`);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(created).not.toHaveBeenCalled();
		expect(await readdir(ctx.cwd)).toEqual([]);
	});

	test.each([
		["text/html", "<html>not PDF</html>"],
		["application/pdf", "not PDF"],
		["application/pdf", "%PDF-1.3\ntruncated"],
		["application/pdf", "%PDF-2.0\n%%EOF\n"],
	])("rejects invalid response %s %s", async (contentType, bytes) => {
		fetcher.mockImplementation(async () => new Response(bytes, { headers: { "Content-Type": contentType } }));
		const ctx = await workspace();
		await expect(tool.execute("bad", input, undefined, undefined, ctx)).rejects.toThrow();
		expect(created).not.toHaveBeenCalled();
		expect(await readdir(ctx.cwd)).toEqual([]);
	});

	test("caps streamed response bytes and cancels oversized reads", async () => {
		const cancel = vi.fn();
		fetcher.mockImplementation(
			async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
						},
						cancel,
					}),
					{ headers: { "Content-Type": "application/pdf" } },
				),
		);
		const ctx = await workspace();
		await expect(tool.execute("bad", input, undefined, undefined, ctx)).rejects.toThrow("exceeds 8 MiB");
		expect(cancel).toHaveBeenCalledOnce();
		expect(await readdir(ctx.cwd)).toEqual([]);
	});

	test("never overwrites existing files or link targets", async () => {
		const ctx = await workspace();
		const target = join(ctx.cwd, "existing.pdf");
		await writeFile(target, "preserve original");
		await symlink(target, join(ctx.cwd, "symlink.pdf"));
		await link(target, join(ctx.cwd, "hardlink.pdf"));
		for (const filename of ["existing.pdf", "symlink.pdf", "hardlink.pdf"]) {
			await expect(tool.execute("bad", { ...input, filename }, undefined, undefined, ctx)).rejects.toThrow("EEXIST");
		}
		expect(await readFile(target, "utf8")).toBe("preserve original");
		expect(created).not.toHaveBeenCalled();
	});

	test("honors cancellation before requesting or after receiving bytes", async () => {
		const ctx = await workspace();
		await expect(tool.execute("cancel", input, AbortSignal.abort(), undefined, ctx)).rejects.toThrow();
		expect(fetcher).not.toHaveBeenCalled();
		const controller = new AbortController();
		fetcher.mockImplementation(async () => {
			controller.abort();
			return new Response(pdf, { headers: { "Content-Type": "application/pdf" } });
		});
		await expect(tool.execute("cancel", input, controller.signal, undefined, ctx)).rejects.toThrow();
		expect(created).not.toHaveBeenCalled();
		expect(await readdir(ctx.cwd)).toEqual([]);
	});
});
