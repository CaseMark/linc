import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { validateDocxFile } from "../src/linc/docx-validate.ts";

const tempDirs: string[] = [];

afterAll(async () => {
	await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function crc32(data: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) {
			crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/** Minimal stored/deflated zip writer — enough to build docx fixtures. */
function buildZip(parts: Record<string, string>): Buffer {
	const localChunks: Buffer[] = [];
	const centralChunks: Buffer[] = [];
	let offset = 0;
	for (const [name, content] of Object.entries(parts)) {
		const nameBuffer = Buffer.from(name, "utf8");
		const data = Buffer.from(content, "utf8");
		const compressed = deflateRawSync(data);
		const checksum = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(8, 8);
		local.writeUInt32LE(checksum, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBuffer.length, 26);
		localChunks.push(local, nameBuffer, compressed);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(8, 10);
		central.writeUInt32LE(checksum, 16);
		central.writeUInt32LE(compressed.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBuffer.length, 28);
		central.writeUInt32LE(offset, 42);
		centralChunks.push(central, nameBuffer);
		offset += 30 + nameBuffer.length + compressed.length;
	}
	const centralStart = offset;
	const centralSize = centralChunks.reduce((total, chunk) => total + chunk.length, 0);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(Object.keys(parts).length, 8);
	eocd.writeUInt16LE(Object.keys(parts).length, 10);
	eocd.writeUInt32LE(centralSize, 12);
	eocd.writeUInt32LE(centralStart, 16);
	return Buffer.concat([...localChunks, ...centralChunks, eocd]);
}

async function writeFixture(name: string, bytes: Buffer): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "docx-validate-"));
	tempDirs.push(dir);
	const filePath = join(dir, name);
	await writeFile(filePath, bytes);
	return filePath;
}

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const CONTENT_TYPES =
	'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>';
const MINIMAL_DOCUMENT = `<?xml version="1.0"?><w:document ${W_NS}><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>`;

function docxParts(extra: Record<string, string> = {}): Record<string, string> {
	return {
		"[Content_Types].xml": CONTENT_TYPES,
		"word/document.xml": MINIMAL_DOCUMENT,
		...extra,
	};
}

describe("validateDocxFile", () => {
	it("accepts a well-formed document with run-wrapped field codes", async () => {
		const footer = `<?xml version="1.0"?><w:ftr ${W_NS}><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
		const filePath = await writeFixture("good.docx", buildZip(docxParts({ "word/footer1.xml": footer })));
		expect(validateDocxFile(filePath)).toEqual([]);
	});

	it("rejects field codes placed directly inside a paragraph (Aug 6 incident shape)", async () => {
		const footer = `<?xml version="1.0"?><w:ftr ${W_NS}><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> PAGE </w:instrText><w:fldChar w:fldCharType="end"/></w:p></w:ftr>`;
		const filePath = await writeFixture("bad-footer.docx", buildZip(docxParts({ "word/footer1.xml": footer })));
		const issues = validateDocxFile(filePath);
		expect(issues.length).toBeGreaterThan(0);
		expect(issues[0]?.part).toBe("word/footer1.xml");
		expect(issues[0]?.problem).toContain("<w:fldChar> is a direct child of <w:p>");
	});

	it("rejects bare text elements outside a run", async () => {
		const document = `<?xml version="1.0"?><w:document ${W_NS}><w:body><w:p><w:t>loose text</w:t></w:p></w:body></w:document>`;
		const filePath = await writeFixture("bare-text.docx", buildZip(docxParts({ "word/document.xml": document })));
		expect(validateDocxFile(filePath).some((issue) => issue.problem.includes("<w:t>"))).toBe(true);
	});

	it("rejects malformed XML (mismatched tags)", async () => {
		const document = `<?xml version="1.0"?><w:document ${W_NS}><w:body><w:p><w:r><w:t>text</w:r></w:t></w:p></w:body></w:document>`;
		const filePath = await writeFixture("mismatched.docx", buildZip(docxParts({ "word/document.xml": document })));
		expect(validateDocxFile(filePath).some((issue) => issue.problem.includes("mismatched closing tag"))).toBe(true);
	});

	it("rejects truncated XML (unclosed element)", async () => {
		const document = `<?xml version="1.0"?><w:document ${W_NS}><w:body><w:p><w:r><w:t>text</w:t></w:r>`;
		const filePath = await writeFixture("truncated.docx", buildZip(docxParts({ "word/document.xml": document })));
		expect(validateDocxFile(filePath).some((issue) => issue.problem.includes("unclosed element"))).toBe(true);
	});

	it("rejects unescaped ampersands in text content", async () => {
		const document = `<?xml version="1.0"?><w:document ${W_NS}><w:body><w:p><w:r><w:t>Smith & Jones</w:t></w:r></w:p></w:body></w:document>`;
		const filePath = await writeFixture("ampersand.docx", buildZip(docxParts({ "word/document.xml": document })));
		expect(validateDocxFile(filePath).some((issue) => issue.problem.includes("unescaped '&'"))).toBe(true);
	});

	it("accepts escaped entities and numeric references", async () => {
		const document = `<?xml version="1.0"?><w:document ${W_NS}><w:body><w:p><w:r><w:t>Smith &amp; Jones &#8212; &#x2019;</w:t></w:r></w:p></w:body></w:document>`;
		const filePath = await writeFixture("entities.docx", buildZip(docxParts({ "word/document.xml": document })));
		expect(validateDocxFile(filePath)).toEqual([]);
	});

	it("rejects a non-zip file", async () => {
		const filePath = await writeFixture("not-a-zip.docx", Buffer.from("this is not a zip archive"));
		const issues = validateDocxFile(filePath);
		expect(issues[0]?.part).toBe("(container)");
		expect(issues[0]?.problem).toContain("not a readable zip archive");
	});

	it("rejects a zip missing word/document.xml", async () => {
		const filePath = await writeFixture(
			"no-document.docx",
			buildZip({ "[Content_Types].xml": CONTENT_TYPES, "word/styles.xml": `<w:styles ${W_NS}/>` }),
		);
		expect(validateDocxFile(filePath)[0]?.problem).toContain("not a valid .docx package");
	});

	it("allows paragraph properties and bookmarks directly under w:p", async () => {
		const document = `<?xml version="1.0"?><w:document ${W_NS}><w:body><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:bookmarkStart w:id="0" w:name="top"/><w:r><w:t>ok</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p></w:body></w:document>`;
		const filePath = await writeFixture("props.docx", buildZip(docxParts({ "word/document.xml": document })));
		expect(validateDocxFile(filePath)).toEqual([]);
	});

	it("rejects run content directly under a hyperlink", async () => {
		const document = `<?xml version="1.0"?><w:document ${W_NS}><w:body><w:p><w:hyperlink><w:t>link text</w:t></w:hyperlink></w:p></w:body></w:document>`;
		const filePath = await writeFixture("hyperlink.docx", buildZip(docxParts({ "word/document.xml": document })));
		expect(validateDocxFile(filePath).some((issue) => issue.problem.includes("<w:hyperlink>"))).toBe(true);
	});
});
