import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { ToolDefinition } from "../core/extensions/types.ts";
import { getCaseDevApiKey } from "./casedev-cli.ts";
import { resolveCaseDevSkillsMcpEndpoint } from "./skills-mcp-client.ts";

const text = Type.String({ maxLength: 16_384 });
const pdfSchema = Type.Object(
	{
		filename: Type.String({
			description: "New .pdf basename in the workspace root. Existing files are never overwritten.",
			pattern: "^[A-Za-z0-9][A-Za-z0-9 _().-]{0,119}\\.pdf$",
		}),
		blocks: Type.Array(
			Type.Union([
				Type.Object({ type: Type.Literal("paragraph"), text }, { additionalProperties: false }),
				Type.Object(
					{ type: Type.Literal("heading"), level: Type.Integer({ minimum: 1, maximum: 3 }), text },
					{ additionalProperties: false },
				),
				Type.Object(
					{
						type: Type.Literal("table"),
						rows: Type.Array(Type.Array(text, { minItems: 1, maxItems: 12 }), {
							minItems: 1,
							maxItems: 100,
							description: "Rectangular literal-text rows. The first row is a repeated column header.",
						}),
					},
					{ additionalProperties: false },
				),
			]),
			{ minItems: 1, maxItems: 256 },
		),
	},
	{ additionalProperties: false },
);

interface PdfResult {
	filePath: string;
	filename: string;
	contentType: "application/pdf";
	bytes: number;
	sha256: string;
	dataOnly: true;
}

const MAX_TEXT_BYTES = 262_144;
const MAX_PDF_BYTES = 8 * 1024 * 1024;
// The existing formatter uses standard PDF fonts (WinAnsi), not embedded
// Unicode fonts. Reject missing glyphs rather than silently losing user text.
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

export function createPdfTool(onCreated: (result: PdfResult) => void): ToolDefinition<typeof pdfSchema, PdfResult> {
	return {
		name: "casedev_document_create_pdf",
		label: "Create PDF document",
		description:
			"Create a new PDF from literal text paragraphs, headings and rectangular tables using the authenticated Case.dev formatter. Tables have up to 100 rows and 12 columns; their first row is a repeated header. Standard PDF fonts only; unsupported characters fail. No caller Markdown, HTML, images, templates, commands, scripts, input files, or external links. Unsupported layouts must be reported, not silently simplified. Writes a new workspace-root basename only. Does not approve remote skill execution. Upload the returned filePath with vault_upload to deliver it to the matter.",
		promptSnippet: "Create a PDF from literal paragraphs, headings and tables without executing remote code.",
		parameters: pdfSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!Value.Check(pdfSchema, params) || !params.filename.endsWith(".pdf")) {
				throw new Error("Invalid structured PDF input");
			}
			signal?.throwIfAborted();
			let total = 0;
			let items = 0;
			let nonempty = false;
			const literalText = (value: string, inTable = false): string => {
				total += Buffer.byteLength(value, "utf8");
				if (total > MAX_TEXT_BYTES) throw new Error(`PDF exceeds ${MAX_TEXT_BYTES} text bytes`);
				if (++items > 4096) throw new Error("PDF exceeds 4096 text items");
				nonempty ||= Boolean(value.trim());
				for (const character of value) {
					const code = character.codePointAt(0)!;
					if (
						!(
							code === 9 ||
							code === 10 ||
							code === 13 ||
							(code >= 32 && code <= 126) ||
							(code >= 160 && code <= 255) ||
							WIN_ANSI_EXTRA.has(character)
						)
					) {
						throw new Error("PDF text contains a character unsupported by the formatter's standard fonts");
					}
				}
				// Encode whitespace and every ASCII punctuation character as a Markdown
				// entity. Only this host-owned heading/line-break syntax is interpreted;
				// image URLs, HTML, links, fences and commands remain literal text.
				return value
					.replaceAll("\r\n", "\n")
					.replaceAll("\r", "\n")
					.split("\n")
					.map((line) => line.replace(/[\t !-/:-@[-`{-~]/g, (char) => `&#${char.charCodeAt(0)};`))
					.join(inTable ? "&#10;" : "  \n");
			};
			const content = params.blocks
				.map((block) => {
					if (block.type === "table") {
						const columns = block.rows[0].length;
						if (block.rows.some((row) => row.length !== columns))
							throw new Error("PDF table must be rectangular");
						const rows = block.rows.map((row) => `| ${row.map((cell) => literalText(cell, true)).join(" | ")} |`);
						rows.splice(1, 0, `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`);
						return rows.join("\n");
					}
					return `${block.type === "heading" ? `${"#".repeat(block.level)} ` : ""}${literalText(block.text)}`;
				})
				.join("\n\n");
			if (!nonempty) throw new Error("PDF requires nonempty text");
			const validatedEndpoint = new URL(resolveCaseDevSkillsMcpEndpoint());
			const apiKey = await getCaseDevApiKey(ctx);
			const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]);
			requestSignal.throwIfAborted();
			const response = await fetch(new URL("/format/v1/document", validatedEndpoint.origin), {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
					Accept: "application/pdf",
				},
				body: JSON.stringify({
					content,
					input_format: "md",
					output_format: "pdf",
					options: {
						styles: { default: { font: "Times New Roman", size: 12 }, p: { font: "Times New Roman", size: 12 } },
					},
				}),
				redirect: "error",
				signal: requestSignal,
			});
			if (
				!response.ok ||
				response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/pdf"
			) {
				await response.body?.cancel();
				throw new Error(`Case.dev PDF formatter returned HTTP ${response.status} or a non-PDF response`);
			}
			if (
				params.blocks.some((block) => block.type === "table") &&
				!response.headers
					.get("x-case-document-features")
					?.split(",")
					.some((feature) => feature.trim() === "pdf-tables-v1")
			) {
				await response.body?.cancel();
				throw new Error("Case.dev formatter does not advertise PDF table support; no file was created");
			}
			const reader = response.body?.getReader();
			if (!reader) throw new Error("Empty Case.dev PDF response");
			const chunks: Uint8Array[] = [];
			let size = 0;
			try {
				for (;;) {
					requestSignal.throwIfAborted();
					const chunk = await reader.read();
					if (chunk.done) break;
					size += chunk.value.byteLength;
					if (size > MAX_PDF_BYTES) throw new Error("Case.dev PDF response exceeds 8 MiB");
					chunks.push(chunk.value);
				}
			} finally {
				await reader.cancel();
			}
			const bytes = Buffer.concat(chunks);
			if (
				!/^%PDF-1\.[0-7]/.test(bytes.subarray(0, 8).toString("ascii")) ||
				!/%%EOF\s*$/.test(bytes.subarray(-1024).toString("ascii"))
			) {
				throw new Error("Case.dev formatter returned invalid PDF bytes");
			}
			requestSignal.throwIfAborted();
			const filePath = join(await realpath(ctx.cwd), params.filename);
			const file = await open(filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
			try {
				await file.writeFile(bytes, { signal: requestSignal });
			} finally {
				await file.close();
			}
			const result: PdfResult = {
				filePath,
				filename: params.filename,
				contentType: "application/pdf",
				bytes: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				dataOnly: true,
			};
			onCreated(result);
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		},
	};
}
