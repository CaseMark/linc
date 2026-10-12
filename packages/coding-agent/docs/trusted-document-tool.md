# Trusted Word documents in the MCP skills pilot

`casedev_document_create` is registered only by the opt-in `skills-mcp`
extension. It turns structured text into a new `.docx` using built-in Linc
code, then returns an absolute `filePath`, MIME type, byte count, and SHA-256.
Use the existing authenticated `vault_upload` tool to deliver that file to an
authorized matter vault. Creation alone does not deliver a file to the user.

Supported blocks:

```json
{
  "filename": "Intake Checklist.docx",
  "blocks": [
    { "type": "heading", "level": 1, "text": "Intake checklist" },
    { "type": "paragraph", "text": "Confirm the client and date." },
    { "type": "table", "rows": [["Item", "Status"], ["Date", "Confirm"]] }
  ]
}
```

The output uses Letter pages, one-inch margins, and 12-point Times New Roman
body text. Heading levels 1–3 and rectangular text tables are supported. Text
is literal data, not Markdown or OOXML. Tabs and line breaks are preserved.

## Filling an existing organization template

The same opt-in extension registers `casedev_document_fill_template`. Read
the mounted `.pi/skills/using-document-templates/references/MANIFEST.json`
and the selected template's instructions first, then provide its exact slug:

```json
{
  "templateSlug": "intake-checklist",
  "filename": "Filled Intake.docx",
  "values": [{ "name": "owner", "value": "Fictional QA client" }]
}
```

This fills literal `{{owner}}` placeholders, including placeholders split
across Word runs, in body paragraphs, tables, headers, and footers. Existing
styles, image bytes, and page geometry are retained. It does not replace the
source template. Missing, duplicate, or unused values fail visibly.

The renderer is fixed host-owned Python code invoked through `/usr/bin/python3`
with `-I -S`, no shell, no inherited environment, and no workspace imports.
Only a manifest slug and plain string values are passed on stdin. The processor
opens each mounted directory and file relative to pinned directory descriptors
with no symlink following, so directory replacement cannot redirect its reads.
Only known passive OOXML part names and raster image formats are accepted.
The empty built-in APA bibliography metadata shipped by ordinary Word/python-docx
templates is preserved only with its matching datastore properties and internal
relationship. Arbitrary or populated custom XML, stylesheet paths and Word data
bindings remain unsupported.
Successful fills append slug, template/output hashes and field names (not their
values) to the existing session audit trail. The Case.dev
Debian image supplies this interpreter; Linux also enforces CPU and address-space
limits. Execution has a 15-second timeout. Input/output are capped at 16 MiB,
ZIP entries at 512, each decompressed part at 8 MiB, total decompressed bytes
at 32 MiB, and supplied UTF-8 text at 256 KiB.

No arbitrary input paths, executable parts, embedded objects, macros, external
relationships, active Word fields, expressions, loops, or nested textbox
paragraphs are supported. Those templates fail rather than degrading to a blank
document. This is **not** certification of every existing customer template or
script-based workflow. Use `vault_upload` to deliver the returned file afterward.

## New-document trust boundary

- No shell, subprocesses, Python imports, remote scripts, templates, input
  files, caller-provided XML, macros, fields, or external relationships.
- Output is a new ASCII `.docx` basename directly in the canonical workspace
  root. No paths, hidden filenames, overwrites, symlinks, or hard-link overwrites.
- Unknown fields and invalid XML characters are rejected. Limits: 256 blocks,
  16,384 characters per text value, 100 rows and 12 columns per table, 4,096
  total text values, and 262,144 total UTF-8 text bytes.
- Loading, selecting, saving, creating, or uploading does **not** approve a
  remote manifest. The existing execution gate remains in effect; changed
  manifests do not inherit approval. Registry failure blocks document creation
  through the same extension tool-call policy.
- Text-only DOCX generation is not binary-template, script, PDF, spreadsheet,
  advanced-formatting, or arbitrary engine-workflow parity. Report unsupported
  requirements rather than silently dropping them or bypassing approval.

## Release acceptance (still required)

1. Review and merge the runtime change, then follow the existing Linc release
   and candidate-image process. Do not change a global runtime pointer or
   production flag to test this change.
2. In an isolated, signed-in ESQ-C3 preview and disposable QA matter: load a
   synthetic private skill, create the document through this native tool, upload
   to the matter, download the delivered object, and inspect the actual bytes.
3. Confirm an unapproved script remains blocked before and after creation and
   upload. Repeat with changed content and resumed session audit state.
4. Certify actual persistent-workspace behavior separately. The local session
   regression does not establish Daytona persistent-workspace support.
5. Production activation requires separate approval after that evidence. Keep
   deprecated C3 unchanged.
