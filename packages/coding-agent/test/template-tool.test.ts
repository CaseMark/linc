import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { validateDocxFile } from "../src/linc/docx-validate.ts";
import { TEMPLATE_FILL_PROGRAM } from "../src/linc/template-fill-program.ts";
import { createTemplateTool } from "../src/linc/template-tool.ts";

const tool = createTemplateTool();
type Input = Parameters<typeof tool.execute>[1];
const directories: string[] = [];
const namespace = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const fixture = {
	"[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
	"word/document.xml": `<w:document ${namespace}><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Owner: {{ow</w:t></w:r><w:r><w:t>ner}}; {{owner}}.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>{{deadline}}</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`,
	"word/header1.xml": `<w:hdr ${namespace}><w:p><w:r><w:t>QA {{owner}}</w:t></w:r></w:p></w:hdr>`,
	"word/footer1.xml": `<w:ftr ${namespace}><w:p><w:r><w:t>Unchanged footer</w:t></w:r></w:p></w:ftr>`,
	"word/styles.xml": `<w:styles ${namespace}><w:style w:type="paragraph" w:styleId="Normal"/></w:styles>`,
	"word/media/image1.png": "retained image bytes",
};
const input: Input = {
	templateSlug: "qa-template",
	filename: "Filled QA.docx",
	values: [
		{ name: "owner", value: "José & Co" },
		{ name: "deadline", value: "Tomorrow\nReview\tNow" },
	],
};
const bibliography = {
	"customXml/item1.xml":
		'<b:Sources xmlns:b="http://schemas.openxmlformats.org/officeDocument/2006/bibliography" SelectedStyle="/APA.XSL" StyleName="APA"/>',
	"customXml/itemProps1.xml":
		'<ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml" ds:itemID="{EF278816-EC6F-A645-907D-7F25AECB1D4A}"><ds:schemaRefs><ds:schemaRef ds:uri="http://schemas.openxmlformats.org/officeDocument/2006/bibliography"/></ds:schemaRefs></ds:datastoreItem>',
	"customXml/_rels/item1.xml.rels":
		'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>',
};

function zip(parts: Record<string, string>): Buffer {
	return execFileSync(
		"/usr/bin/python3",
		[
			"-I",
			"-S",
			"-c",
			`import io,json,sys,zipfile
b=io.BytesIO()
with zipfile.ZipFile(b,'w',compression=zipfile.ZIP_DEFLATED) as z:
    for name,value in json.load(sys.stdin).items(): z.writestr(name,value)
sys.stdout.buffer.write(b.getvalue())`,
		],
		{ input: JSON.stringify(parts) },
	);
}

function unzip(bytes: Buffer): Record<string, string> {
	return JSON.parse(
		execFileSync(
			"/usr/bin/python3",
			[
				"-I",
				"-S",
				"-c",
				`import io,json,sys,zipfile
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
    print(json.dumps({name:z.read(name).decode() for name in z.namelist()}))`,
			],
			{ input: bytes },
		).toString(),
	);
}

async function workspace(parts: Record<string, string> = fixture) {
	const cwd = await realpath(await mkdtemp(join(tmpdir(), "linc-template-test-")));
	directories.push(cwd);
	const root = join(cwd, ".pi/skills/using-document-templates");
	await mkdir(join(root, "assets"), { recursive: true });
	await mkdir(join(root, "references"));
	const bytes = zip(parts);
	await writeFile(join(root, "assets/qa-template.docx"), bytes);
	await writeFile(
		join(root, "references/MANIFEST.json"),
		JSON.stringify({
			version: 1,
			templates: [{ slug: input.templateSlug, templatePath: "assets/qa-template.docx" }],
		}),
	);
	return { ctx: { cwd } as ExtensionContext, root, bytes };
}

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("bounded trusted template fill", () => {
	test("retains ordinary Word empty APA bibliography metadata without approving arbitrary custom XML", async () => {
		const { ctx } = await workspace({ ...fixture, ...bibliography });
		const result = await tool.execute("fill", input, undefined, undefined, ctx);
		const parts = unzip(await readFile(result.details.filePath));
		for (const [name, xml] of Object.entries(bibliography)) expect(parts[name]).toBe(xml);
		expect(parts["word/document.xml"]).toContain("José &amp; Co");
	});

	test.each([
		{ "customXml/item1.xml": bibliography["customXml/item1.xml"].replace("/APA.XSL", "https://evil.invalid/a.xsl") },
		{ "customXml/item1.xml": bibliography["customXml/item1.xml"].replace("/>", "><b:Source/></b:Sources>") },
		{ "customXml/item1.xml": '<a:Sources xmlns:a="https://evil.invalid"/>' },
		{
			"customXml/itemProps1.xml": bibliography["customXml/itemProps1.xml"].replace(
				'ds:uri="http://schemas.openxmlformats.org/officeDocument/2006/bibliography"',
				'ds:uri="https://evil.invalid"',
			),
		},
		{
			"customXml/_rels/item1.xml.rels": bibliography["customXml/_rels/item1.xml.rels"].replace(
				'Target="itemProps1.xml"',
				'Target="../evil.xml"',
			),
		},
		{
			"customXml/_rels/item1.xml.rels": bibliography["customXml/_rels/item1.xml.rels"].replace(
				'Target="itemProps1.xml"',
				'Target="itemProps2.xml"',
			),
		},
		{
			"customXml/_rels/item1.xml.rels": bibliography["customXml/_rels/item1.xml.rels"].replace(
				'Target="itemProps1.xml"',
				'TargetMode="External" Target="https://evil.invalid"',
			),
		},
		{
			"word/document.xml": fixture["word/document.xml"].replace(
				"<w:body>",
				'<w:body><w:dataBinding w:xpath="/b:Sources"/>',
			),
		},
		{ "word/document.xml": fixture["word/document.xml"].replace("<w:body>", "<w:body><w:customXml/>") },
	])("refuses bibliography mutations and active bindings", async (extra) => {
		const { ctx } = await workspace({ ...fixture, ...bibliography, ...extra });
		await expect(tool.execute("fill", input, undefined, undefined, ctx)).rejects.toThrow("Template fill failed");
		await expect(readFile(join(ctx.cwd, input.filename))).rejects.toThrow();
	});

	test("refuses orphan bibliography parts", async () => {
		const { ctx } = await workspace({ ...fixture, "customXml/item1.xml": bibliography["customXml/item1.xml"] });
		await expect(tool.execute("fill", input, undefined, undefined, ctx)).rejects.toThrow("Incomplete");
	});

	test("refuses additional bibliography triples outside the canonical item1 package", async () => {
		const additional = Object.fromEntries(
			Object.entries(bibliography).map(([name, xml]) => [
				name.replace("1", "2"),
				xml.replace("itemProps1.xml", "itemProps2.xml"),
			]),
		);
		const { ctx } = await workspace({ ...fixture, ...bibliography, ...additional });
		await expect(tool.execute("fill", input, undefined, undefined, ctx)).rejects.toThrow("Unsupported or active");
	});

	test("fills split/repeated runs, tables and headers while preserving styles, images and geometry", async () => {
		const { ctx, bytes } = await workspace();
		const result = await tool.execute("fill", input, undefined, undefined, ctx);
		const output = await readFile(result.details.filePath);
		const parts = unzip(output);
		expect(validateDocxFile(result.details.filePath)).toEqual([]);
		expect(parts["word/document.xml"]).toContain("José &amp; Co");
		expect(parts["word/document.xml"]).toContain("<w:rPr><w:b/></w:rPr>");
		expect(parts["word/document.xml"]).toContain('<w:pgSz w:w="12240" w:h="15840"/>');
		expect(parts["word/document.xml"]).toContain("<w:br/>");
		expect(parts["word/document.xml"]).toContain("<w:tab/>");
		expect(parts["word/header1.xml"]).toContain("QA José &amp; Co");
		for (const name of ["word/styles.xml", "word/footer1.xml", "word/media/image1.png"])
			expect(parts[name]).toBe(fixture[name as keyof typeof fixture]);
		expect(await readFile(join(ctx.cwd, ".pi/skills/using-document-templates/assets/qa-template.docx"))).toEqual(
			bytes,
		);
		expect(result.details).toMatchObject({
			templateSha256: createHash("sha256").update(bytes).digest("hex"),
			sha256: createHash("sha256").update(output).digest("hex"),
			fields: ["deadline", "owner"],
			dataOnly: true,
		});
		expect(result.details).not.toHaveProperty("executionApproved");
	});

	test("treats code, XML and template-looking values as literal data", async () => {
		const { ctx } = await workspace();
		const value = "</w:t><w:instrText>evil</w:instrText> $(touch owned) {{literal}} {% no %}";
		const result = await tool.execute(
			"fill",
			{ ...input, values: [{ name: "owner", value }, input.values[1]!] },
			undefined,
			undefined,
			ctx,
		);
		const parts = unzip(await readFile(result.details.filePath));
		expect(parts["word/document.xml"]).toContain("&lt;w:instrText&gt;evil");
		expect(parts["word/document.xml"]).not.toContain("<w:instrText>");
		expect(parts["word/document.xml"]).toContain("{{literal}}");
		await expect(readFile(join(ctx.cwd, "owned"))).rejects.toThrow();
	});

	test.each(["../escape.docx", "/tmp/x.docx", "x.docx\n", "file.py", "x.docx\u0000"])(
		"rejects filename %j",
		async (filename) => {
			const { ctx } = await workspace();
			await expect(tool.execute("fill", { ...input, filename }, undefined, undefined, ctx)).rejects.toThrow(
				"Invalid",
			);
		},
	);

	test.each<Record<string, string>>([
		{ "word/embeddings/evil.bin": "active" },
		{ "word/vbaData.xml": "<a/>" },
		{ "word/oleObject1.xml": "<a/>" },
		{ "customXml/item1.xml": "<a/>" },
		{ "word/media/evil.xll": "active" },
		{ "word/media/evil.xla": "active" },
		{ "word/media/evil.dylib": "active" },
		{ "word/media/evil.svg": "<svg/>" },
		{ "../escape": "bad" },
		{
			"word/_rels/document.xml.rels":
				'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship TargetMode="External" Target="https://example.invalid"/></Relationships>',
		},
		{
			"word/document.xml": `<w:document ${namespace}><w:body><w:p><w:r><w:instrText>DDE evil</w:instrText></w:r></w:p></w:body></w:document>`,
		},
		{
			"word/document.xml": `<w:document ${namespace}><w:body><w:p><w:r><w:t>{{owner.upper()}}</w:t></w:r></w:p></w:body></w:document>`,
		},
		{ "word/document.xml": '<!DOCTYPE a [<!ENTITY x "evil">]><a/>' },
		{
			"word/document.xml": `<w:document ${namespace}><w:body><w:p><w:r><w:delText>{{owner}}</w:delText></w:r></w:p></w:body></w:document>`,
		},
		{ "word/bomb.xml": "x".repeat(8 * 1024 * 1024 + 1) },
	])("rejects unsafe/unsupported template parts", async (extra) => {
		const { ctx } = await workspace({ ...fixture, ...extra });
		await expect(tool.execute("fill", input, undefined, undefined, ctx)).rejects.toThrow("Template fill failed");
		await expect(readFile(join(ctx.cwd, input.filename))).rejects.toThrow();
	});

	test("rejects missing, duplicate and unused values", async () => {
		const { ctx } = await workspace();
		for (const values of [
			[input.values[0]!],
			[...input.values, input.values[0]!],
			[...input.values, { name: "extra", value: "unused" }],
		]) {
			await expect(tool.execute("fill", { ...input, values }, undefined, undefined, ctx)).rejects.toThrow();
		}
	});

	test("does not overwrite output or follow a manifest directory symlink", async () => {
		const { ctx, root } = await workspace();
		await writeFile(join(ctx.cwd, input.filename), "original");
		await expect(tool.execute("fill", input, undefined, undefined, ctx)).rejects.toThrow("output already exists");
		expect(await readFile(join(ctx.cwd, input.filename), "utf8")).toBe("original");
		await rm(join(root, "references"), { recursive: true });
		await symlink(ctx.cwd, join(root, "references"));
		await expect(tool.execute("fill", input, undefined, undefined, ctx)).rejects.toThrow("unsafe");
	});

	test.each(["assets", "references"])("pins %s through a deterministic directory replacement", async (directory) => {
		const { ctx, bytes } = await workspace();
		const target = `.pi/skills/using-document-templates/${directory}`;
		const trigger = directory === "assets" ? "qa-template.docx" : "MANIFEST.json";
		// Test-only fault injection at the actual read, after its directory FD was
		// opened. Production never accepts a program or hook from a caller.
		const program = TEMPLATE_FILL_PROGRAM.replace(
			"def read_regular(name, directory, budget):",
			`def read_regular(name, directory, budget):
    if name == '${trigger}':
        os.rename('${target}', '${target}-original')
        os.symlink('/nonexistent-outside-template', '${target}')`,
		);
		const result = JSON.parse(
			execFileSync("/usr/bin/python3", ["-I", "-S", "-c", program], {
				cwd: ctx.cwd,
				env: {},
				input: JSON.stringify({
					templateSlug: input.templateSlug,
					values: Object.fromEntries(input.values.map((field) => [field.name, field.value])),
				}),
			}).toString(),
		) as { templateSha256: string; document: string };
		expect(result.templateSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
		expect(unzip(Buffer.from(result.document, "base64"))["word/document.xml"]).toContain("José &amp; Co");
	});

	test.each(["symlink", "hardlink"])("rejects a template file %s and hides workspace paths", async (kind) => {
		const { ctx, root } = await workspace();
		const file = join(root, "assets/qa-template.docx");
		const original = join(ctx.cwd, "original.docx");
		await writeFile(original, await readFile(file));
		await rm(file);
		if (kind === "symlink") await symlink(original, file);
		else await link(original, file);
		const error = await tool.execute("fill", input, undefined, undefined, ctx).catch((error) => error as Error);
		expect(error).toBeInstanceOf(Error);
		if (!(error instanceof Error)) throw new Error("Expected refusal");
		expect(error.message).not.toContain(ctx.cwd);
	});

	test("honors cancellation and rejects caller scripts", async () => {
		const { ctx } = await workspace();
		await expect(tool.execute("fill", input, AbortSignal.abort(), undefined, ctx)).rejects.toThrow();
		await expect(
			tool.execute("fill", { ...input, script: "evil" } as Input, undefined, undefined, ctx),
		).rejects.toThrow("Invalid");
	});
});
