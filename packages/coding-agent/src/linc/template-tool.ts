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
async function renderTemplate(
	cwd: string,
	templateSlug: string,
	values: Record<string, string>,
	signal?: AbortSignal,
): Promise<{ bytes: Buffer; templateSha256: string }> {
	return new Promise((resolve, reject) => {
		// This interpreter is part of the Case.dev Debian image. No PATH lookup,
		// inherited credential env, caller script, workspace import, or shell.
		const child = execFile(
			"/usr/bin/python3",
			["-I", "-S", "-c", TEMPLATE_FILL_PROGRAM],
			{ cwd, env: {}, timeout: 15_000, maxBuffer: 24 * 1024 * 1024, signal, killSignal: "SIGKILL" },
			(error, stdout, stderr) => {
				if (error) {
					reject(
						new Error(
							`Template fill failed: ${stderr.trim().slice(0, 400) || "Trusted processor unavailable, cancelled, or budget exceeded"}`,
						),
					);
					return;
				}
				try {
					const result: unknown = JSON.parse(stdout);
					if (
						!result ||
						typeof result !== "object" ||
						!("document" in result) ||
						typeof result.document !== "string" ||
						!("templateSha256" in result) ||
						typeof result.templateSha256 !== "string" ||
						!/^[a-f0-9]{64}$/.test(result.templateSha256)
					) {
						throw new Error("Invalid trusted template result");
					}
					const document = Buffer.from(result.document, "base64");
					if (!document.length || document.length > MAX_TEMPLATE_BYTES)
						throw new Error("Invalid template output size");
					resolve({ bytes: document, templateSha256: result.templateSha256 });
				} catch (failure) {
					reject(failure);
				}
			},
		);
		child.stdin?.on("error", () => reject(new Error("Trusted template processor input failed")));
		child.stdin?.end(JSON.stringify({ templateSlug, values }));
	});
}

export function createTemplateTool(
	onFilled?: (result: TemplateResult) => void,
): ToolDefinition<typeof templateSchema, TemplateResult> {
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
			let cwd: string;
			try {
				cwd = await realpath(ctx.cwd);
			} catch {
				throw new Error("Template workspace is unavailable");
			}
			const { bytes, templateSha256 } = await renderTemplate(cwd, params.templateSlug, values, signal);
			signal?.throwIfAborted();
			const filePath = join(cwd, params.filename);
			const file = await open(filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600).catch(
				() => {
					throw new Error("Template output already exists or cannot be created");
				},
			);
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
				templateSha256,
				contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				bytes: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				fields: Object.keys(values).sort(),
				dataOnly: true,
			};
			onFilled?.(result);
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		},
	};
}
