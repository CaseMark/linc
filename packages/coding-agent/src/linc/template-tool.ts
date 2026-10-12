import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { ToolDefinition } from "../core/extensions/types.ts";
import { TEMPLATE_FILL_PROGRAM } from "./template-fill-program.ts";

const templateSchema = Type.Object(
	{
		templateSlug: Type.String({ pattern: "^[a-z0-9]+(-[a-z0-9]+)*$", minLength: 2, maxLength: 80 }),
		filename: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9 _().-]{0,119}\\.docx$" }),
		values: Type.Array(
			Type.Object(
				{
					name: Type.String({ pattern: "^[A-Za-z][A-Za-z0-9_]{0,63}$", maxLength: 64 }),
					value: Type.String({ maxLength: 16_384 }),
				},
				{ additionalProperties: false },
			),
			{ minItems: 1, maxItems: 128 },
		),
	},
	{ additionalProperties: false },
);
interface TemplateResult {
	filePath: string;
	filename: string;
	templateSlug: string;
	templateSha256: string;
	contentType: string;
	bytes: number;
	sha256: string;
	fields: string[];
	dataOnly: true;
}
const MAX_TEMPLATE_BYTES = 16 * 1024 * 1024;
const TEMPLATE_ROOT = ".pi/skills/using-document-templates";

async function readBoundedFile(path: string, maxBytes: number): Promise<Buffer> {
	const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const info = await file.stat();
		if (!info.isFile() || info.nlink !== 1 || info.size > maxBytes)
			throw new Error("Unsafe or oversized template file");
		const bytes = Buffer.alloc(info.size + 1);
		let offset = 0;
		while (offset < bytes.length) {
			const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
			if (!bytesRead) break;
			offset += bytesRead;
		}
		const after = await file.stat();
		if (offset !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs)
			throw new Error("Template changed during read");
		return bytes.subarray(0, offset);
	} finally {
		await file.close();
	}
}

async function renderTemplate(bytes: Buffer, values: Record<string, string>, signal?: AbortSignal): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		// This interpreter is part of the Case.dev Debian image. No PATH lookup,
		// inherited credential env, caller script, workspace import, or shell.
		const child = execFile(
			"/usr/bin/python3",
			["-I", "-S", "-c", TEMPLATE_FILL_PROGRAM],
			{ env: {}, timeout: 15_000, maxBuffer: 24 * 1024 * 1024, signal, killSignal: "SIGKILL" },
			(error, stdout, stderr) => {
				if (error) {
					reject(new Error(`Template fill failed: ${stderr.trim().slice(0, 400) || error.message}`));
					return;
				}
				try {
					const result: unknown = JSON.parse(stdout);
					if (
						!result ||
						typeof result !== "object" ||
						!("document" in result) ||
						typeof result.document !== "string"
					) {
						throw new Error("Invalid trusted template result");
					}
					const document = Buffer.from(result.document, "base64");
					if (!document.length || document.length > MAX_TEMPLATE_BYTES)
						throw new Error("Invalid template output size");
					resolve(document);
				} catch (failure) {
					reject(failure);
				}
			},
		);
		child.stdin?.on("error", reject);
		child.stdin?.end(JSON.stringify({ template: bytes.toString("base64"), values }));
	});
}

export function createTemplateTool(): ToolDefinition<typeof templateSchema, TemplateResult> {
	return {
		name: "casedev_document_fill_template",
		label: "Fill Word template",
		description:
			"Fill an org template already mounted in using-document-templates/MANIFEST.json by slug. Supply plain string values for literal {{field}} placeholders, including split Word runs. Preserves existing styles, tables, images, headers, footers and page geometry. No scripts, expressions, loops, macros, external links or arbitrary input paths. Writes a new workspace-root .docx; never replaces the template or approves remote skill execution. Unsupported templates fail visibly; do not substitute a blank document. Upload returned filePath with vault_upload.",
		promptSnippet: "Fill an existing org Word template with plain data without executing remote skill code.",
		parameters: templateSchema,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (
				!Value.Check(templateSchema, params) ||
				!params.filename.endsWith(".docx") ||
				/[^a-z0-9-]/.test(params.templateSlug)
			) {
				throw new Error("Invalid template fill input");
			}
			signal?.throwIfAborted();
			const values: Record<string, string> = Object.create(null);
			for (const field of params.values) {
				if (Object.hasOwn(values, field.name)) throw new Error("Duplicate template field");
				values[field.name] = field.value;
			}
			const cwd = await realpath(ctx.cwd);
			const root = join(cwd, TEMPLATE_ROOT);
			if (
				(await realpath(root)) !== root ||
				(await realpath(join(root, "assets"))) !== join(root, "assets") ||
				(await realpath(join(root, "references"))) !== join(root, "references")
			) {
				throw new Error("Template directory must not be a symlink");
			}
			const manifest: unknown = JSON.parse(
				(await readBoundedFile(join(root, "references/MANIFEST.json"), 262_144)).toString("utf8"),
			);
			if (
				!manifest ||
				typeof manifest !== "object" ||
				!("templates" in manifest) ||
				!Array.isArray(manifest.templates)
			) {
				throw new Error("Invalid injected template manifest");
			}
			const matches = manifest.templates.filter(
				(entry: unknown) =>
					entry && typeof entry === "object" && "slug" in entry && entry.slug === params.templateSlug,
			);
			const entry: unknown = matches[0];
			if (
				matches.length !== 1 ||
				!entry ||
				typeof entry !== "object" ||
				!("templatePath" in entry) ||
				typeof entry.templatePath !== "string" ||
				!/^assets\/[A-Za-z0-9][A-Za-z0-9_.-]{0,199}\.docx$/.test(entry.templatePath) ||
				!entry.templatePath.endsWith(".docx")
			) {
				throw new Error("Template missing or unsafe in the injected org manifest");
			}
			const template = await readBoundedFile(join(root, entry.templatePath), MAX_TEMPLATE_BYTES);
			signal?.throwIfAborted();
			const bytes = await renderTemplate(template, values, signal);
			signal?.throwIfAborted();
			const filePath = join(cwd, params.filename);
			const file = await open(filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
			try {
				try {
					await file.writeFile(bytes);
					signal?.throwIfAborted();
				} finally {
					await file.close();
				}
			} catch (error) {
				await unlink(filePath);
				throw error;
			}
			const result: TemplateResult = {
				filePath,
				filename: params.filename,
				templateSlug: params.templateSlug,
				templateSha256: createHash("sha256").update(template).digest("hex"),
				contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				bytes: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				fields: Object.keys(values).sort(),
				dataOnly: true,
			};
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		},
	};
}
