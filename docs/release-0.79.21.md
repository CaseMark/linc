# Linc 0.79.21 verification

Prepared September 17, 2026 for the CD-1583 Case.dev MCP skills rollout.
The release remains draft until an authenticated Node and Bun completion smoke is
completed or Theodore explicitly accepts that risk.

## MCP skills artifact verification

The release tarball was installed into an empty directory outside the repository.
The installed CLI reported `0.79.21`; all three bundled pi packages were present at
`0.79.10`; and the installed JavaScript contained the feature-gated MCP extension,
discovery tool, bounded-manifest validation, digest verification, and execution
approval enforcement.

The standalone macOS ARM64 archive reported `0.79.21`, rendered help, listed
models, and imported its bundled `skills-mcp.js` without repository dependencies.
`scripts/build-binaries.sh` now includes that extension in the same dependency
bundling step used for Matter and Vault. Without that addition, the external
extension file would not have carried its `typebox` runtime dependency.

The Linux x64 archive was also built and inspected. Its `pi` executable is an
x86-64 ELF binary, the archive contains `pi/dist/linc/extensions/skills-mcp.js`,
the extension imports successfully from the extracted archive, and the bundled
JavaScript has no bare `typebox` import. The extracted file contains the bounded
manifest, discovery, and host-side execution-denial paths.

The MCP path is still disabled unless `LINC_MCP_SKILLS_PILOT=1`. Production MCP
access additionally requires the existing explicit production-host approval; this
release does not enable any Case.dev or product feature flag.

## Validation

- `npm run build`: passed.
- `npm run check`: passed.
- `node scripts/publish.mjs --dry-run`: passed; the tarball contains all three pi
  packages plus their 99-package runtime dependency closure.
- Empty-directory tarball install: passed version, bundle, and shipped MCP-JS
  assertions.
- macOS ARM64 release archive: passed version, help, model-listing, and bundled
  MCP-extension import checks.
- Linux x64 release archive: passed archive-content, ELF architecture, bundled
  MCP-extension import, dependency-closure, and enforcement-path assertions.
- Removed-model migration diagnostics: all three removed built-in IDs report the
  current provider default and `--list-models`; resolver tests passed 34/34 and
  the built CLI exited 1 with the targeted message for `opencode/union-alpha`.
- `./test.sh`: agent 164 passed; AI 331 passed / 764 skipped; coding-agent 1537
  passed / 44 skipped with one transient `stdout-cleanliness` version assertion;
  TUI 647 passed. The failed file passed all 5 tests immediately when rerun alone.

No provider credential was used during the offline suite or artifact checks.

## Authenticated smoke status

The installed Node tarball and standalone Bun archive both reached the preview
Case.dev endpoint using the existing C3 Preview credential, but the endpoint
returned HTTP 401 before a completion. That credential is stale or invalid, so
this is not a successful authenticated smoke and no completion was billed. The
release remains draft pending a valid preview credential or Theodore's explicit
risk acceptance. Production credentials were not used and production flags were
not changed.

## Catalog regeneration

The generator source is unchanged. Two consecutive live-feed generations produced
the same files. SHA-256:

```text
63ecd332300ea51dc0088bd3892d3c1218db5c60f7f02c638a69494070de49ea  models.generated.ts
c19b1e4d0bf7a22455581dbf3a5e4fb43b79c7fbe02e61a00acac9c3f5ad164b  image-models.generated.ts
```

The models.dev feed contains Mistral `zai-glm-5-3` with a 1,000,000-token
context window, 131,072-token output limit, and 1.4 / 4.4 / 0.14 USD-per-million
input / output / cache-read prices. It no longer contains `union-alpha` for the
OpenCode or OpenCode Go providers.

The following OpenRouter values were compared with the live model API. Prices are
input / output / cache-read USD per million tokens; limits are context / maximum
output tokens.

| Model | Change | Prices | Limits |
| --- | --- | --- | --- |
| `deepseek/deepseek-v4-flash` | Updated | 0.088606 / 0.177212 / 0.0177212 | 1,048,576 / 384,000 |
| `deepseek/deepseek-v4-flash-0731:free` | Added | 0 / 0 / 0 | 1,048,576 / 393,216 |
| `deepseek/deepseek-v4-flash-vision-exp` | Updated | 0.2156 / 0.6468 / 0.00686 | 1,048,576 / 262,144 |
| `deepseek/deepseek-v4-pro-0813` | Updated | 1.32 / 3.96 / 0.044 | 1,048,576 / 384,000 |
| `deepseek/deepseek-v4.1-flash` | Updated | 0.3 / 1.2 / 0.006 | 1,048,576 / 384,000 |
| `google/gemma-4-26b-a4b-it` | Context updated | 0.09 / 0.3 / 0.05 | 1,000,000 / 235,929 |
| `moonshotai/kimi-k3` | Updated | 2.1 / 10.95 / 0.23 | 1,048,576 / 943,718 |
| `openai/gpt-oss-120b` | Updated | 0.15 / 0.6 / 0.075 | 131,072 / 65,536 |
| `tencent/hy3` | Updated | 0.132 / 0.528 / 0.033 | 262,144 / 128,000 |
| `unbiased/pareto` | Added | 2.5 / 7.5 / 0.25 | 262,144 / 131,072 |
| `z-ai/glm-5.2` | Updated | 0.4875 / 1.56 / 0.091 | 1,048,576 / 163,840 |
| `~deepseek/deepseek-flash-latest` | Updated | 0.15 / 0.6 / 0.015 | 1,048,576 / 943,718 |
| `~deepseek/deepseek-pro-latest` | Updated | 0.7 / 2.96 / 0.033 | 1,048,576 / 384,000 |
| `~deepseek/deepseek-v4-flash-latest` | Updated | 0.0558 / 0.1767 / 0.0088 | 1,310,720 / 943,718 |
| `~z-ai/glm-latest` | Updated | 0.7735 / 2.431 / 0.127075 | 1,310,720 / 943,718 |

OpenRouter no longer lists `stealth/union-alpha`. Its removal, plus the two
models.dev removals, is called out in the changelog because saved built-in model
selections must change. The CLI now rejects those three removed built-in IDs with
a targeted message suggesting the current default for that provider:
`opencode/kimi-k2.6`, `opencode-go/kimi-k2.6`, or
`openrouter/moonshotai/kimi-k2.6`. It does not silently remap the selection;
`linc --list-models` remains the source of current alternatives.

## Remaining release and rollout gates

1. Complete authenticated print-mode and interactive completion smoke for the
   installed Node tarball and standalone Bun archive, or record Theodore's risk
   acceptance.
2. Theodore merges the release PR with a merge commit and pushes `v0.79.21`.
3. Approve and verify the npm publication of `@casemark/linc@0.79.21`.
4. Only after npm publication, merge the separate Case.dev preview pin PR and let
   preview snapshot validation bake the candidate.
5. Run the isolated end-to-end MCP workflow with the product flag on in preview.
   Production remains off until that smoke and rollback checks pass.
