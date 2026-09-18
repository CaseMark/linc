# Linc 0.79.22 release verification

## Scope

This patch releases the CD-1182 pagination fix merged in PR #75. The Case.dev
MCP loader still checks every organization-private page first. Once the public
catalog begins, it resolves the requested public skill directly with the
required `skills/get` method instead of scanning the rest of the public catalog.

Only `@casemark/linc` is bumped to 0.79.22. The bundled
`@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, and
`@earendil-works/pi-tui` packages remain at 0.79.10.

## Catalog review

The release build regenerated the provider catalogs from their live sources.
There were no model additions or removals. OpenRouter changed metadata for two
models:

- `~deepseek/deepseek-flash-latest`: input $0.135/M, output $0.54/M, cache read
  $0.00405/M, and 943,718 maximum output tokens.
- `~deepseek/deepseek-v4-flash-latest`: input $0.05236/M, output $0.15708/M, and
  cache read $0.001666/M.

The generated values were checked against OpenRouter's live models endpoint.

## Validation

- `npm run build`: passed.
- `npm run check`: passed.
- MCP client regression suite: 11/11 passed.
- Offline suite: agent 164 passed; AI 331 passed / 764 skipped; coding-agent
  1544 passed / 44 skipped with three concurrent packaging-race failures; TUI
  647 passed. All three affected coding-agent files passed immediately in
  isolation (11/11 tests).
- `node scripts/publish.mjs --dry-run`: passed; the tarball contained all three
  pi packages and their 99-package runtime dependency closure.
- Empty-directory tarball install: reported 0.79.22, retained all bundled pi
  packages at 0.79.10, and contained the compiled `skills/get` boundary fix.
- macOS ARM64 standalone archive: version, help, model listing, compiled MCP
  payload, authenticated print-mode completion, and interactive completion all
  passed.
- Installed Node tarball: version, help, model listing, authenticated print-mode
  completion, and interactive completion all passed.

## Publication

After this release PR is merged with a merge commit, a human maintainer pushes
the approved `v0.79.22` tag. The tag starts the npm and binary publication
workflows. The publishing tag must not move after it has been pushed.
