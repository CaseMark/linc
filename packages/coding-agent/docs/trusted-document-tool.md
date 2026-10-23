# Case.dev skills and document tools

The bundled `skills-mcp` extension gives Linc the organization's own skills and the public Case.dev catalog over MCP, plus native Word, PDF and template tools.

## Turning it on

The host sets `LINC_MCP_SKILLS=1`. `LINC_MCP_SKILLS_PILOT=1` is the deprecated name and still works until the next minor release.

The extension calls `/mcp` on the runtime Case.dev API origin (`CASEDEV_BASE_URL`, or `CASE_API_URL`) with the session's Case.dev key. `LINC_MCP_SKILLS_ENDPOINT` may name the endpoint explicitly, but it must have the same origin, so the key is never sent to another environment. The endpoint must use HTTPS; plain HTTP is accepted only for `localhost`, `127.0.0.1` and `[::1]`.

## Tools

| Tool | What it does |
|---|---|
| `casedev_skill_discover` | Lists skills one page at a time: built-in skills first, then the organization's, then the public catalog. A catalog skill with the same name as a built-in one is hidden. Names and descriptions only. |
| `casedev_skill_load` | Loads a skill by name or `skill://` URI and returns its `SKILL.md` and the folder holding all of its files. |
| `casedev_document_create` | Builds a `.docx` from headings, paragraphs and tables. |
| `casedev_document_create_pdf` | Builds a PDF from the same blocks through the Case.dev formatter. Tables require the server's `pdf-tables-v1` capability. |
| `casedev_document_fill_template` | Fills `{{field}}` placeholders in an org Word template mounted under `.pi/skills/using-document-templates`. |

## How a loaded skill behaves

Loading a built-in skill reads it from its existing folder, with no network call.

Loading an organization or catalog skill downloads every file in its manifest, checks each one against its SHA-256 digest and size, and writes the bundle to `<cwd>/.linc/mcp-skills/<name>/` with its original relative paths. Text and binary files are handled the same way. A bundle that is already on disk with the same manifest digest is reused. A changed bundle replaces the old folder in one rename, and a failed download leaves the previous version in place.

From there the skill behaves exactly like a preinstalled one: its scripts, references and assets are read and run from that folder with the normal tools. Skills from Case.dev get the same trust as preinstalled skills; loading one does not restrict any other tool.

## Errors

Requests time out after 15 seconds. HTTP 429, 502, 503 and 504 and network errors are retried twice, honouring `Retry-After` up to 5 seconds. Any other failure fails only the call that hit it; other tools keep working.

## Limits

Each skill may have up to 512 files and 16 MiB in total, with binary files up to 3 MiB each. A single response may be up to 8 MiB. Organization skill listings are read up to 100 pages when resolving a name.

## Audit

Each discover, load, registry error, PDF creation and template fill appends a `linc.skills-mcp-audit` session entry. Loads record the skill URI, manifest digest and folder. Template fills record field names, never values.
