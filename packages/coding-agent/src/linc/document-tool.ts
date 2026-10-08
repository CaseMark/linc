import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import type { ToolDefinition } from "../core/extensions/types.ts";

const textSchema = Type.String({ maxLength: 16_384 });
const documentSchema = Type.Object(
	{
		filename: Type.String({
			description: "New .docx filename in the workspace root, not a path. Existing files are never overwritten.",
			// Provider schema validators reject regex lookaround (CD-1763).
			pattern: "^[A-Za-z0-9][A-Za-z0-9 _().-]{0,119}\\.docx$",
		}),
		blocks: Type.Array(
			Type.Union([
				Type.Object({ type: Type.Literal("paragraph"), text: textSchema }, { additionalProperties: false }),
				Type.Object(
					{ type: Type.Literal("heading"), level: Type.Integer({ minimum: 1, maximum: 3 }), text: textSchema },
					{ additionalProperties: false },
				),
				Type.Object(
					{
						type: Type.Literal("table"),
						rows: Type.Array(Type.Array(textSchema, { minItems: 1, maxItems: 12 }), {
							minItems: 1,
							maxItems: 100,
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

type DocumentInput = Static<typeof documentSchema>;
interface DocumentResult {
	filePath: string;
	filename: string;
	contentType: string;
	bytes: number;
	sha256: string;
	dataOnly: true;
}
const MAX_TEXT_BYTES = 262_144;
const MAX_TEXT_ITEMS = 4_096;
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const WORD_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function escapeText(text: string): string {
	// Validate XML 1.0 code points, including rejecting lone UTF-16 surrogates.
	for (const character of text) {
		const code = character.codePointAt(0)!;
		if (
			code !== 9 &&
			code !== 10 &&
			code !== 13 &&
			!(code >= 0x20 && code <= 0xd7ff) &&
			!(code >= 0xe000 && code <= 0xfffd) &&
			!(code >= 0x10000 && code <= 0x10ffff)
		) {
			throw new Error("Document text contains an invalid XML character");
		}
	}
	return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function paragraph(text: string, headingLevel?: number): string {
	const content = escapeText(text)
		.replaceAll("\r\n", "\n")
		.replaceAll("\r", "\n")
		.replaceAll("\n", '</w:t><w:br/><w:t xml:space="preserve">')
		.replaceAll("\t", '</w:t><w:tab/><w:t xml:space="preserve">');
	const properties = headingLevel ? `<w:pPr><w:keepNext/><w:outlineLvl w:val="${headingLevel - 1}"/></w:pPr>` : "";
	const runProperties = headingLevel ? `<w:rPr><w:b/><w:sz w:val="${36 - headingLevel * 4}"/></w:rPr>` : "";
	return `<w:p>${properties}<w:r>${runProperties}<w:t xml:space="preserve">${content}</w:t></w:r></w:p>`;
}

function documentXml(params: DocumentInput): string {
	let textBytes = 0;
	let textItems = 0;
	const body: string[] = [];
	for (const block of params.blocks) {
		const texts = block.type === "table" ? block.rows.flat() : [block.text];
		textItems += texts.length;
		textBytes += texts.reduce((sum, text) => sum + Buffer.byteLength(text, "utf8"), 0);
		if (textBytes > MAX_TEXT_BYTES || textItems > MAX_TEXT_ITEMS) {
			throw new Error(`Document exceeds ${MAX_TEXT_BYTES} text bytes or ${MAX_TEXT_ITEMS} text items`);
		}
		if (block.type !== "table") {
			body.push(paragraph(block.text, block.type === "heading" ? block.level : undefined));
			continue;
		}
		const columns = block.rows[0].length;
		if (block.rows.some((row) => row.length !== columns)) throw new Error("Table rows must have equal cell counts");
		const width = Math.floor(9360 / columns);
		const grid = Array.from({ length: columns }, () => `<w:gridCol w:w="${width}"/>`).join("");
		const rows = block.rows
			.map(
				(row) =>
					`<w:tr>${row.map((text) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${paragraph(text)}</w:tc>`).join("")}</w:tr>`,
			)
			.join("");
		body.push(
			`<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`,
		);
	}
	return `${XML_HEADER}<w:document xmlns:w="${WORD_NAMESPACE}"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

// Fixed, bounded OOXML parts use ZIP STORE. No external package, subprocess,
// local executable, arbitrary XML, template, or caller-selected input file.
function packDocument(document: string): Buffer {
	const parts = {
		"[Content_Types].xml": `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
		"_rels/.rels": `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
		"word/_rels/document.xml.rels": `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
		"word/styles.xml": `${XML_HEADER}<w:styles xmlns:w="${WORD_NAMESPACE}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
		"word/document.xml": document,
	};
	const localChunks: Buffer[] = [];
	const centralChunks: Buffer[] = [];
	let offset = 0;
	for (const [name, xml] of Object.entries(parts)) {
		const filename = Buffer.from(name, "utf8");
		const data = Buffer.from(xml, "utf8");
		let crc = 0xffffffff;
		for (const byte of data) {
			crc ^= byte;
			for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
		}
		const checksum = (crc ^ 0xffffffff) >>> 0;
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x800, 6);
		local.writeUInt16LE(33, 12); // DOS date: 1980-01-01.
		local.writeUInt32LE(checksum, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(filename.length, 26);
		localChunks.push(local, filename, data);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x800, 8);
		central.writeUInt16LE(33, 14);
		central.writeUInt32LE(checksum, 16);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(filename.length, 28);
		central.writeUInt32LE(offset, 42);
		centralChunks.push(central, filename);
		offset += local.length + filename.length + data.length;
	}
	const centralSize = centralChunks.reduce((size, chunk) => size + chunk.length, 0);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(parts).length, 8);
	end.writeUInt16LE(Object.keys(parts).length, 10);
	end.writeUInt32LE(centralSize, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...localChunks, ...centralChunks, end]);
}

export function createDocumentTool(): ToolDefinition<typeof documentSchema, DocumentResult> {
	return {
		name: "casedev_document_create",
		label: "Create Word document",
		description:
			"Create a new .docx from plain text paragraphs, headings, and rectangular tables using trusted built-in code. Data only: no scripts, commands, arbitrary XML, templates, input files, external links, or macros. Writes only a new filename in the workspace root. Does not approve remote skill execution. Upload the returned filePath with vault_upload to deliver it to the matter.",
		promptSnippet: "Create a Word document from structured text without executing remote skill code.",
		parameters: documentSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			// JavaScript's $ can match before a final line terminator. Keep that
			// stricter runtime boundary without advertising unsupported lookaround.
			if (!Value.Check(documentSchema, params) || !params.filename.endsWith(".docx")) {
				throw new Error("Invalid structured document input");
			}
			signal?.throwIfAborted();
			const bytes = packDocument(documentXml(params));
			const filePath = join(await realpath(ctx.cwd), params.filename);
			signal?.throwIfAborted();
			// Exclusive creation also rejects existing symlinks and hard links.
			const file = await open(filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
			try {
				await file.writeFile(bytes);
			} finally {
				await file.close();
			}
			signal?.throwIfAborted();
			const result: DocumentResult = {
				filePath,
				filename: params.filename,
				contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				bytes: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				dataOnly: true,
			};
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		},
	};
}
