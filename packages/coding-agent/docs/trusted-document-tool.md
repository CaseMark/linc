# Trusted documents in the MCP skills pilot

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

## Creating a PDF with text and tables

The extension also registers `casedev_document_create_pdf`. It accepts a new
`.pdf` basename and literal paragraphs, headings (levels 1–3), and rectangular
text tables, with the same 256-block, 16,384-character/value, 4,096-value and
256 KiB UTF-8 text limits. Tables have at most 100 rows and 12 columns; the
first row is a repeated column header. It sends
host-escaped text to the existing authenticated `/format/v1/document` API at
the configured runtime/MCP origin. The API owns rendering; no workspace code,
shell commands, input files, HTML, images, external URLs, arbitrary formatter
options or template components are accepted. Credentials use the existing
Case.dev runtime auth storage, without fallback keys or redirects. Production
requires the existing explicit MCP production approval.

The formatter uses standard PDF fonts. ASCII, Latin-1 printable characters and
Windows-1252 punctuation are supported; other characters fail visibly to avoid
missing glyphs. This is not full Unicode/font parity with native Word output.

```json
{
  "filename": "Summary.pdf",
  "blocks": [
    { "type": "heading", "level": 1, "text": "Synthetic summary" },
    { "type": "paragraph", "text": "A literal summary with citations." },
    { "type": "table", "rows": [["Item", "Amount"], ["Fee", "$12"]] }
  ]
}
```

Table rendering requires `pdf-tables-v1` in the formatter's
`X-Case-Document-Features` response header. The client rejects table output from
older formatters before writing a file; paragraph/heading-only PDFs still work.
Release the formatter first, then the client. Unknown fields and malformed tables are rejected rather than silently
flattened. Word-template conversion, advanced layouts and arbitrary engine workflows remain unsupported.
Report these limitations before substituting a simpler deliverable.

PDF requests have a 30-second timeout and no automatic retry. Returned bytes
must have PDF MIME type, a version 1.0–1.7 header and EOF marker, and fit within
8 MiB. A formatter upgrade to PDF 2.0 requires revalidation rather than silently
expanding this boundary. These
checks identify the trusted formatter's output; they are not a sanitizer for
arbitrary third-party PDFs. Output is exclusively created in the canonical
workspace root with mode 0600. Creation appends only output hash and byte count
to the session audit, never document text or credentials. Use `vault_upload`
afterward; creating the local file alone does not deliver it. The existing
registry-failure block and manifest-bound execution approvals remain unchanged.

## Reading binary skill companions

`casedev_skill_read` accepts only an exact resource URI from a loaded skill's
held manifest. Text remains origin-marked, escaped untrusted content. For MCP
`blob` responses, Linc decodes canonical base64 and checks the decoded byte count
and SHA-256 before writing anything. `SKILL.md` must remain textual. Each binary
file is capped at 3 MiB; the complete manifest remains capped at 512 resources
and 16 MiB. A missing, changed, malformed or revoked resource fails closed.

Verified binary bytes are written mode 0600 under a new private `mcp-asset-*`
directory in the canonical workspace. The output uses a host-owned basename,
not a remote directory tree. The tool returns an absolute `filePath`, content
digest, MIME metadata, origin and `untrustedAsset: true`. Native data tools may
read or upload that path. MIME metadata is not a safety certification, and
arbitrary PDFs are not sanitized by downloading them. Binary MIME metadata is
limited to 256 UTF-8 bytes before it can enter tool results or audit entries.

Assets remain until the workspace owner or host removes them. Ephemeral sandbox
teardown removes the workspace; the extension itself does not run background
cleanup or cache eviction. Each read deliberately creates a fresh private path
rather than overwriting or trusting a cached asset. Long-lived workspace hosts
must account for these directories in their disk quotas and retention policy.
Do not delete an asset while a tool or user still relies on its returned path.

No companion is installed in `.pi/skills`, `.agents/skills` or another trusted
skill directory. Reading binary data never approves code, bypasses the shell
guard, or adds a manifest to the execution allowlist. New server/client releases
must be validated together before binary bundles are republished; the existing
binary repair guard must remain in place until then.

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
- Text-only DOCX generation is not binary-template, script, spreadsheet,
  advanced-formatting, or arbitrary engine-workflow parity. Report unsupported
  requirements rather than silently dropping them or bypassing approval.

## Release acceptance (still required)

1. Review and merge the runtime change into staging, validate it there, then
   promote the full staging branch to main through a reviewed release before
   following the Linc publication and candidate-image process. Do not select
   only this fix for production. Do not change a global runtime pointer or
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
