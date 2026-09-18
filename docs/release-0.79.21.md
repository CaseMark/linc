# Linc 0.79.21 verification

Prepared September 17, 2026 for the CD-1583 Case.dev MCP skills rollout.
Authenticated Node and Bun print-mode and interactive completion smokes are
complete against the preview Case.dev endpoint.

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
  current provider default and `--list-models`, including when a valid thinking
  suffix is present. Saved defaults prefer the same suggested replacement;
  restored sessions surface that guidance and use it when they need to select an
  available fallback. Resolver tests passed 39/39, and the built CLI exited 1
  with the targeted message for `opencode/union-alpha`.
- Case.dev catalog cold-start regression: preview and production catalog requests
  were observed taking 3.6-10 seconds, beyond the former 3-second startup ceiling.
  The ceiling is now 15 seconds, with a fake-timer regression proving a 6-second
  response succeeds. The focused catalog tests passed 9/9 and `npm run check`
  passed.
- `./test.sh`: agent 164 passed; AI 331 passed / 764 skipped; coding-agent 1537
  passed / 44 skipped with one transient `stdout-cleanliness` version assertion;
  TUI 647 passed. The failed file passed all 5 tests immediately when rerun alone.

No provider credential was used during the offline suite or artifact checks.

## Authenticated smoke status

The exact preview tenant credential returned HTTP 200 from `/llm/config`. Against
that preview endpoint and `casemark/core-large`, both the installed Node tarball
and standalone Bun archive returned `LINC_SMOKE_OK` in print mode and
`LINC_INTERACTIVE_OK` from a real controlled-terminal turn. This completes the
authenticated release gate.

The exact production credential also returned HTTP 200 from the non-billing
`/llm/config` check. No production completion was run, no production feature flag
was enabled, and no production deployment was changed.

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

1. Theodore merges the release PR with a merge commit and pushes `v0.79.21`.
2. Approve and verify the npm publication of `@casemark/linc@0.79.21`.
3. Only after npm publication, merge the separate Case.dev preview pin PR and let
   preview snapshot validation bake the candidate.
4. Run the isolated end-to-end MCP workflow with the product flag on in preview.
   Production remains off until that smoke and rollback checks pass.

If preview validation fails after publication, revert the Case.dev preview pin to
the previously published Linc version and rebuild the preview snapshot. npm
versions are immutable, so rollback changes the pin rather than attempting to
reuse or overwrite `0.79.21`; the production pin and feature flag remain
unchanged throughout the preview rollout.
