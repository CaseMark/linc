import { createHash } from "node:crypto";
import { link, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { createDocumentTool } from "../src/linc/document-tool.ts";
import { validateDocxFile } from "../src/linc/docx-validate.ts";

const directories: string[] = [];
const tool = createDocumentTool();
type Input = Parameters<typeof tool.execute>[1];

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function workspace() {
	const cwd = await mkdtemp(join(tmpdir(), "linc-document-test-"));
	directories.push(cwd);
	return { cwd } as ExtensionContext;
}

function readStoredParts(bytes: Buffer): Map<string, string> {
	const parts = new Map<string, string>();
	let at = 0;
	while (bytes.readUInt32LE(at) === 0x04034b50) {
		expect(bytes.readUInt16LE(at + 8)).toBe(0);
		const size = bytes.readUInt32LE(at + 18);
		const nameLength = bytes.readUInt16LE(at + 26);
		const extraLength = bytes.readUInt16LE(at + 28);
		const name = bytes.toString("utf8", at + 30, at + 30 + nameLength);
		const start = at + 30 + nameLength + extraLength;
		parts.set(name, bytes.toString("utf8", start, start + size));
		at = start + size;
	}
	return parts;
}

const simple: Input = { filename: "intake.docx", blocks: [{ type: "paragraph", text: "Plain text" }] };

describe("native data-only Word document tool", () => {
	test("generates a structurally valid document, escapes data, and returns verifiable bytes", async () => {
		const ctx = await workspace();
		const literal = '</w:t><w:instrText>INCLUDETEXT "https://example.invalid"</w:instrText> & $(touch owned)';
		const result = await tool.execute(
			"create",
			{
				filename: "QA Checklist.docx",
				blocks: [
					{ type: "heading", level: 1, text: "Intake & Review" },
					{ type: "paragraph", text: `${literal}\nUnicode: José ⚖\tClient` },
					{
						type: "table",
						rows: [
							["Item", "Status"],
							["Date", "Confirm"],
						],
					},
				],
			},
			undefined,
			undefined,
			ctx,
		);
		const bytes = await readFile(result.details.filePath);
		expect(result.details).toMatchObject({
			filePath: join(await realpath(ctx.cwd), "QA Checklist.docx"),
			bytes: bytes.length,
			sha256: createHash("sha256").update(bytes).digest("hex"),
			dataOnly: true,
		});
		expect(result.details).not.toHaveProperty("executionApproved");
		expect(validateDocxFile(result.details.filePath)).toEqual([]);
		const parts = readStoredParts(bytes);
		expect([...parts.keys()]).toEqual([
			"[Content_Types].xml",
			"_rels/.rels",
			"word/_rels/document.xml.rels",
			"word/styles.xml",
			"word/document.xml",
		]);
		const xml = parts.get("word/document.xml")!;
		expect(xml).toContain("&lt;w:instrText&gt;INCLUDETEXT");
		expect(xml).not.toContain("<w:instrText>");
		expect(xml).toContain("Unicode: José ⚖");
		expect(xml).toContain("<w:br/>");
		expect(xml).toContain("<w:tab/>");
		expect(xml.match(/<w:tc>/g)).toHaveLength(4);
		for (const part of parts.values()) expect(part).not.toContain('TargetMode="External"');
		expect(await readdir(ctx.cwd)).toEqual(["QA Checklist.docx"]);
		if (process.platform !== "win32") expect((await stat(result.details.filePath)).mode & 0o777).toBe(0o600);
	});

	test.each([
		"../escape.docx",
		"/tmp/escape.docx",
		"folder/file.docx",
		"folder\\file.docx",
		".hidden.docx",
		"x.docx\n",
		"file.py",
		"x.docx\u0000",
	])("rejects unsafe filenames: %j", async (filename) => {
		const ctx = await workspace();
		await expect(tool.execute("bad", { ...simple, filename }, undefined, undefined, ctx)).rejects.toThrow("Invalid");
		expect(await readdir(ctx.cwd)).toEqual([]);
	});

	test.each(["xml", "script", "command", "template", "inputPath", "outputPath", "relationships"])(
		"rejects extra input field %s",
		async (field) => {
			const ctx = await workspace();
			const params = { ...simple, [field]: "malicious input" } as Input;
			await expect(tool.execute("bad", params, undefined, undefined, ctx)).rejects.toThrow("Invalid");
			expect(await readdir(ctx.cwd)).toEqual([]);
		},
	);

	test("rejects raw XML fields within a block", async () => {
		const ctx = await workspace();
		const params: unknown = { ...simple, blocks: [{ type: "paragraph", text: "text", xml: "<w:p/>" }] };
		await expect(tool.execute("bad", params as Input, undefined, undefined, ctx)).rejects.toThrow("Invalid");
	});

	test.each(["\u0000", "\u0001", "\ud800", "\udfff", "\ufffe", "\uffff"])(
		"rejects invalid XML characters: %j",
		async (text) => {
			const ctx = await workspace();
			await expect(
				tool.execute("bad", { ...simple, blocks: [{ type: "paragraph", text }] }, undefined, undefined, ctx),
			).rejects.toThrow("invalid XML character");
			expect(await readdir(ctx.cwd)).toEqual([]);
		},
	);

	test("rejects oversized input and ragged tables without creating a file", async () => {
		const ctx = await workspace();
		for (const blocks of [
			Array.from({ length: 17 }, () => ({ type: "paragraph" as const, text: "x".repeat(16_384) })),
			Array.from({ length: 257 }, () => ({ type: "paragraph" as const, text: "x" })),
			[{ type: "paragraph" as const, text: "x".repeat(16_385) }],
			[{ type: "heading" as const, level: 4, text: "x" }],
			[{ type: "table" as const, rows: [["one"], ["two", "three"]] }],
			Array.from({ length: 4 }, () => ({
				type: "table" as const,
				rows: Array.from({ length: 100 }, () => Array.from({ length: 12 }, () => "")),
			})),
		]) {
			await expect(tool.execute("bad", { ...simple, blocks }, undefined, undefined, ctx)).rejects.toThrow();
		}
		expect(await readdir(ctx.cwd)).toEqual([]);
	});

	test("never overwrites a file, symlink, or hard link", async () => {
		const ctx = await workspace();
		const existing = join(ctx.cwd, "existing.docx");
		await writeFile(existing, "preserve original");
		await symlink(existing, join(ctx.cwd, "symlink.docx"));
		await link(existing, join(ctx.cwd, "hardlink.docx"));
		for (const filename of ["existing.docx", "symlink.docx", "hardlink.docx"]) {
			await expect(tool.execute("bad", { ...simple, filename }, undefined, undefined, ctx)).rejects.toThrow(
				"EEXIST",
			);
		}
		expect(await readFile(existing, "utf8")).toBe("preserve original");
	});

	test("honors cancellation before creating a file", async () => {
		const ctx = await workspace();
		await expect(tool.execute("cancelled", simple, AbortSignal.abort(), undefined, ctx)).rejects.toThrow();
		expect(await readdir(ctx.cwd)).toEqual([]);
	});
});
