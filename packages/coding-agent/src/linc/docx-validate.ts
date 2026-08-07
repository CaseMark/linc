import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

/**
 * Structural validation for generated .docx files, run before vault uploads so
 * a document Word would refuse to open fails here — inside the sandbox, where
 * the agent can repair it — instead of on the user's machine.
 *
 * Deliberately narrow: it only flags defects Word hard-rejects (unreadable zip
 * container, malformed part XML, run-level content outside a <w:r>). Schema
 * violations Word tolerates (e.g. python-docx's stock settings.xml, tcPr child
 * order) are not flagged, so stock python-docx output always passes.
 */

export interface DocxValidationIssue {
	part: string;
	problem: string;
}

const ZIP_EOCD_SIG = 0x06054b50;
const ZIP_CENTRAL_SIG = 0x02014b50;
const ZIP_LOCAL_SIG = 0x04034b50;

interface ZipEntry {
	name: string;
	method: number;
	compressedSize: number;
	localHeaderOffset: number;
}

function readZipEntries(buffer: Buffer): ZipEntry[] | null {
	const scanStart = Math.max(0, buffer.length - 65_557);
	let eocd = -1;
	for (let i = buffer.length - 22; i >= scanStart; i--) {
		if (buffer.readUInt32LE(i) === ZIP_EOCD_SIG) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error("no end-of-central-directory record found");
	const entryCount = buffer.readUInt16LE(eocd + 10);
	let offset = buffer.readUInt32LE(eocd + 16);
	if (entryCount === 0xffff || offset === 0xffffffff) {
		// Zip64 archive — outside this minimal reader's scope. Callers treat
		// this as "cannot judge", not as a broken file.
		return null;
	}
	const entries: ZipEntry[] = [];
	for (let i = 0; i < entryCount; i++) {
		if (buffer.readUInt32LE(offset) !== ZIP_CENTRAL_SIG) {
			throw new Error(`corrupt central directory at entry ${i}`);
		}
		const nameLength = buffer.readUInt16LE(offset + 28);
		const extraLength = buffer.readUInt16LE(offset + 30);
		const commentLength = buffer.readUInt16LE(offset + 32);
		entries.push({
			name: buffer.toString("utf8", offset + 46, offset + 46 + nameLength),
			method: buffer.readUInt16LE(offset + 10),
			compressedSize: buffer.readUInt32LE(offset + 20),
			localHeaderOffset: buffer.readUInt32LE(offset + 42),
		});
		offset += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

function readZipEntryData(buffer: Buffer, entry: ZipEntry): Buffer {
	const at = entry.localHeaderOffset;
	if (buffer.readUInt32LE(at) !== ZIP_LOCAL_SIG) {
		throw new Error(`corrupt local header for ${entry.name}`);
	}
	const nameLength = buffer.readUInt16LE(at + 26);
	const extraLength = buffer.readUInt16LE(at + 28);
	const dataStart = at + 30 + nameLength + extraLength;
	const raw = buffer.subarray(dataStart, dataStart + entry.compressedSize);
	if (entry.method === 0) return Buffer.from(raw);
	if (entry.method === 8) return inflateRawSync(raw);
	throw new Error(`unsupported compression method ${entry.method} for ${entry.name}`);
}

/**
 * Elements that are only valid inside a <w:r> run. Field codes and literal
 * text placed directly under <w:p> (or <w:hyperlink>) make Word reject the
 * whole document — the exact failure shipped in the Aug 6 incident.
 */
const RUN_ONLY_CONTENT = new Set([
	"w:t",
	"w:delText",
	"w:instrText",
	"w:delInstrText",
	"w:fldChar",
	"w:br",
	"w:cr",
	"w:tab",
	"w:ptab",
	"w:sym",
	"w:noBreakHyphen",
	"w:softHyphen",
	"w:drawing",
	"w:pict",
	"w:object",
	"w:footnoteReference",
	"w:endnoteReference",
]);

const RUN_CONTAINER_PARENTS = new Set(["w:p", "w:hyperlink", "w:smartTag"]);

const XML_ENTITY_PATTERN = /^(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/;

function lintXmlPart(part: string, xml: string): DocxValidationIssue[] {
	const issues: DocxValidationIssue[] = [];
	const stack: string[] = [];
	let i = 0;
	while (i < xml.length) {
		const lt = xml.indexOf("<", i);
		if (lt < 0) break;
		const text = xml.slice(i, lt);
		const badAmp = findBadAmpersand(text);
		if (badAmp) issues.push({ part, problem: badAmp });
		if (xml.startsWith("<?", lt)) {
			const end = xml.indexOf("?>", lt);
			if (end < 0) return [...issues, { part, problem: "unterminated processing instruction" }];
			i = end + 2;
			continue;
		}
		if (xml.startsWith("<!--", lt)) {
			const end = xml.indexOf("-->", lt);
			if (end < 0) return [...issues, { part, problem: "unterminated comment" }];
			i = end + 3;
			continue;
		}
		if (xml.startsWith("<![CDATA[", lt)) {
			const end = xml.indexOf("]]>", lt);
			if (end < 0) return [...issues, { part, problem: "unterminated CDATA section" }];
			i = end + 3;
			continue;
		}
		const tagEnd = findTagEnd(xml, lt);
		if (tagEnd < 0) return [...issues, { part, problem: "unterminated tag (missing '>')" }];
		const tag = xml.slice(lt + 1, tagEnd);
		i = tagEnd + 1;
		if (tag.startsWith("/")) {
			const name = tag.slice(1).trim();
			const open = stack.pop();
			if (open !== name) {
				issues.push({
					part,
					problem: `mismatched closing tag </${name}>${open ? ` (expected </${open}>)` : " (no open element)"}`,
				});
				return issues;
			}
			continue;
		}
		const selfClosing = tag.endsWith("/");
		const name = (selfClosing ? tag.slice(0, -1) : tag).split(/[\s/]/, 1)[0]?.trim() ?? "";
		if (!name) {
			issues.push({ part, problem: "empty tag name" });
			return issues;
		}
		if (RUN_ONLY_CONTENT.has(name)) {
			const parent = stack[stack.length - 1];
			if (parent !== undefined && RUN_CONTAINER_PARENTS.has(parent)) {
				issues.push({
					part,
					problem: `<${name}> is a direct child of <${parent}>; run-level content (text, field codes, breaks) must be wrapped in a <w:r> run element`,
				});
			}
		}
		if (!selfClosing) stack.push(name);
	}
	if (stack.length > 0) {
		issues.push({ part, problem: `unclosed element <${stack[stack.length - 1]}>` });
	}
	return issues;
}

function findTagEnd(xml: string, lt: number): number {
	let quote: string | null = null;
	for (let i = lt + 1; i < xml.length; i++) {
		const ch = xml[i];
		if (quote) {
			if (ch === quote) quote = null;
		} else if (ch === '"' || ch === "'") {
			quote = ch;
		} else if (ch === ">") {
			return i;
		}
	}
	return -1;
}

function findBadAmpersand(text: string): string | null {
	let at = text.indexOf("&");
	while (at >= 0) {
		if (!XML_ENTITY_PATTERN.test(text.slice(at + 1, at + 12))) {
			return "unescaped '&' in text content (must be '&amp;' or a valid entity reference)";
		}
		at = text.indexOf("&", at + 1);
	}
	return null;
}

/** Validate a .docx file on disk. Returns [] when the document is acceptable. */
export function validateDocxFile(filePath: string): DocxValidationIssue[] {
	let buffer: Buffer;
	try {
		buffer = readFileSync(filePath);
	} catch (error) {
		return [{ part: "(container)", problem: `cannot read file: ${String(error)}` }];
	}
	let entries: ZipEntry[] | null;
	try {
		entries = readZipEntries(buffer);
	} catch (error) {
		return [
			{
				part: "(container)",
				problem: `not a readable zip archive (${error instanceof Error ? error.message : String(error)})`,
			},
		];
	}
	if (entries === null) return [];
	const names = new Set(entries.map((entry) => entry.name));
	if (!names.has("[Content_Types].xml") || !names.has("word/document.xml")) {
		return [
			{
				part: "(container)",
				problem: "missing [Content_Types].xml or word/document.xml — not a valid .docx package",
			},
		];
	}
	const issues: DocxValidationIssue[] = [];
	for (const entry of entries) {
		if (!/\.(xml|rels)$/i.test(entry.name)) continue;
		let xml: string;
		try {
			xml = readZipEntryData(buffer, entry).toString("utf8");
		} catch (error) {
			issues.push({
				part: entry.name,
				problem: `cannot decompress part (${error instanceof Error ? error.message : String(error)})`,
			});
			continue;
		}
		issues.push(...lintXmlPart(entry.name, xml));
	}
	return issues;
}

/** Human-readable multi-line summary used in the vault_upload error message. */
export function formatDocxValidationIssues(issues: DocxValidationIssue[]): string {
	const seen = new Set<string>();
	const lines: string[] = [];
	for (const issue of issues) {
		const line = `- ${issue.part}: ${issue.problem}`;
		if (seen.has(line)) continue;
		seen.add(line);
		lines.push(line);
	}
	return lines.join("\n");
}
