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

## Trust boundary

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
