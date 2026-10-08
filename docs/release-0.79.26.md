# Linc 0.79.26 release verification

Tracked in [CD-1763](https://linear.app/casemarkai/issue/CD-1763).
Base: main `7991148987a7e4498cc9a9bb91764387114d78ed`.
Only `@casemark/linc` becomes 0.79.26. The three bundled pi packages and
their dependency ranges remain 0.79.10. This document describes an unpublished
release candidate, not live PanelWorks acceptance or production activation.

## Changelog audit — 2026-10-08

Dante authorized the repository's `/cl` audit to be performed by the agent.
The original implementation change since 0.79.25 is [#89](https://github.com/CaseMark/linc/pull/89):
the opt-in native document tool advertises a portable filename regex instead of
unsupported lookaround, while its runtime validation still rejects trailing
line terminators and unsafe filenames before any write. Added unit cases and a
faux-provider MCP-extension regression cover that boundary.

The audit found one missing coding-agent Fixed entry, now included. No new
feature or cross-package duplication is required. Release housekeeping is
excluded; existing ai/agent/tui Unreleased entries are unchanged. Previously
released Linc sections are unchanged.

Dante subsequently authorized fixing the remaining release gates. This follow-up
changes only the unconfigured standalone defaults for `casedev` and
`casemark-core` to the existing first fallback, `casemark/core-potassium`.
Explicit CLI selections, saved defaults, existing sessions and product model
overrides are preserved. Eight added regressions cover both providers. The new
Fixed entry is now included in the unpublished 0.79.26 release section;
Unreleased is empty again. The Core Large backend incident is not repaired
or renamed by this client-default change and remains open in CD-1686.

## Verification

- Node 22.22.2 clean install with `npm ci --ignore-scripts`, full live-catalog
  build, full `npm run check`, shrinkwrap verification, browser smoke and
  `node scripts/publish.mjs --dry-run` pass.
- Version/lockfile/shrinkwrap deltas only change Linc version fields. No
  dependency upgrade, lifecycle-script allowance or upstream package version
  change is included.
- Full non-provider suite: **2,753 passed, 827 skipped**, with Vitest workers
  capped at two. The first run overlapped with packaging and failed module
  resolution while temporary bundled dependencies were removed. A clean
  install followed by the sequential complete suite passed without source
  changes or additional skipped tests. The original auth backup was restored.
- The actual tarball installs into an empty directory with
  `--omit=dev --ignore-scripts`. Its runtime audit has **zero findings**; root
  development/example advisories are separate and unchanged. Installed Linc is
  0.79.26 and bundled pi packages are 0.79.10. Installed document-tool and MCP
  extension JS hashes equal the workspace build.
- Installed document creation passes ZIP/XML and digest inspection, hostile
  text escaping, mode 0600, exclusive creation, path-traversal rejection and
  all five trailing line-terminator cases. The advertised installed schema has
  no lookaround. No remote-skill execution approval is granted.
- The macOS ARM64 Bun binary builds successfully. Installed Node and Bun
  version/help/model-list checks and read-only authentication selection pass
  outside the repository using isolated configuration directories.
  Other platforms and CI's Bun version still require release CI.
- The original **HTTP 401 is attributed to the smoke harness**, which mistakenly
  used preview `CASEMARK_API_KEY` as a Case.dev client credential. Its value does
  not have the Case.dev API-key format. The corrected harness reads the existing
  preview `CASE_API_KEY` in memory, sends it only to `preview.api.case.dev`, and
  uses isolated auth/config directories and a minimal environment. No key is
  rotated, written into artifacts, or printed; no production credential is used.
- **Original canary-model live smokes pass:** PanelWorks' staging source default
  is `openai/gpt-6-luna`, but the current effective staging `C3_MODEL_ID` override
  is `anthropic/claude-haiku-5.5`. Both the installed Node tarball and Bun binary
  complete print and controlled-PTY interactive requests through provider
  `casedev` with GPT-6 Luna. Additional Node/Bun print and interactive checks
  against the effective Haiku 5.5 staging override also pass. Each returns its
  expected synthetic marker without model fallback and exits 0.
  Startup/account-listing alone is not counted.
- The actual packed `casedev_document_create` schema is also accepted by that
  preview provider: HTTP 200, expected synthetic reply, `finish_reason: stop`,
  zero tool calls. `tool_choice: none` prohibits execution; no matter content or
  remote scripts are involved. This certifies the shipped schema, not merely
  workspace source.
- **Original bare-CLI default failure was diagnosed:** the previous unconfigured
  Case.dev default was `casemark/core-large`, not the product's model.
  A direct synthetic request returns HTTP 502 / `UPSTREAM_PROVIDER_UNAVAILABLE`;
  scoped preview logs prove Baseten HTTP **410 Gone** for its retired
  `moonshotai/Kimi-K2.7-Code` route. This pre-existing incident is tracked in
  [CD-1686](https://linear.app/casemarkai/issue/CD-1686), with new evidence added.
  Subsequent successful Core Potassium replies after Linc changed the isolated
  saved default are **not** counted as clean Core Large certification. The
  authorized standalone-default fix below does not change that backend route,
  product configuration or pricing, and does not certify Core Large.
- Initial print checks accidentally inherited offline mode and unrelated
  provider configuration; their successful markers are excluded from release
  acceptance. The corrected checks allow only preview Case.dev authentication
  and isolate config. Unconfigured settings automatically selected
  `casemark-core` / `casemark/core-large`; the product-model checks explicitly
  configure the product policy in isolated settings, with no CLI overrides.
  The original product certification used the explicitly configured models
  above. The follow-up separately certifies the new standalone default.

### Live evidence — 2026-10-08

| Shipped runtime / check | Configured provider / model | Result |
| --- | --- | --- |
| Installed Node print | `casedev` / `openai/gpt-6-luna` | `CD1763_NODE_RELEASE_OK`, exit 0 |
| Bun macOS ARM64 print | `casedev` / `openai/gpt-6-luna` | `CD1763_BUN_RELEASE_OK`, exit 0 |
| Installed Node interactive PTY | `casedev` / `openai/gpt-6-luna` | Actual `CD1763_NODE_INTERACTIVE_OK` assistant reply, `/quit`, exit 0 |
| Bun macOS ARM64 interactive PTY | `casedev` / `openai/gpt-6-luna` | Actual `CD1763_BUN_INTERACTIVE_OK` assistant reply, `/quit`, exit 0 |
| Installed Node print, staging override | `casedev` / `anthropic/claude-haiku-5.5` | `CD1763_NODE_RELEASE_OK`, exit 0 |
| Bun macOS ARM64 print, staging override | `casedev` / `anthropic/claude-haiku-5.5` | `CD1763_BUN_RELEASE_OK`, exit 0 |
| Installed Node interactive PTY, staging override | `casedev` / `anthropic/claude-haiku-5.5` | Actual `CD1763_NODE_STAGING_INTERACTIVE_OK` assistant reply, `/quit`, exit 0 |
| Bun macOS ARM64 interactive PTY, staging override | `casedev` / `anthropic/claude-haiku-5.5` | Actual `CD1763_BUN_STAGING_INTERACTIVE_OK` assistant reply, `/quit`, exit 0 |
| Packed document schema, preview API | `openai/gpt-6-luna` | HTTP 200, `CD1763_SCHEMA_OK`, stop, no tool calls |

API preview deployment: `dpl_6GH7feAGj9haiMPvp6ENpEK2aHkC`, commit
`89db57c89d3e76f6a32cdf9de0a1586eb67d519c`. Core Large diagnostic request:
`iad1::9dtwx-1791483265448-3665e88f2638`. Only synthetic instructions were sent.
Corrected local harness: `/tmp/cd1763-release-preview-auth.mjs`; product settings
are under `node-product-config`, `bun-product-config`, `node-staging-config` and
`bun-staging-config` in the artifact directory. These contain model selection/
telemetry settings, not credentials. Staging policy source blob:
`337c389f9d64425caba41f38e3ae665add037dc9`; read-only configuration probe:
`/tmp/cd1763-product-default.mjs`. No staged/customer chat was modified.

The table above records the original candidate. Follow-up artifacts and evidence
below supersede its archive hashes. This is **not** full product MCP cutover
acceptance.

### Standalone-default fix — 2026-10-08

- Model resolver: **43/43 tests pass**, including eight new default/preservation
  regressions. Full `npm run check` and sequential full `./test.sh` pass with no
  additional skips or provider credentials. Only coding-agent JS was rebuilt;
  the already reviewed generated catalogs and bundled pi builds are unchanged.
- Publish dry run, new packed install and macOS ARM64 binary build pass.
  Installed resolver, document-tool and MCP-extension JS hashes match the
  workspace build. Installed runtime audit: **zero findings**. All 11 retired-ID
  fallback checks and installed document safety checks pass again.
- Fresh isolated settings contain no default provider/model and use no CLI
  model override or offline mode. Both Node and Bun automatically select
  `casemark-core` / `casemark/core-potassium`. Print replies contain
  `CD1763_NODE_DEFAULT_OK` / `CD1763_BUN_DEFAULT_OK`. Controlled PTYs return
  actual assistant replies `CD1763_NODE_DEFAULT_INTERACTIVE_OK` /
  `CD1763_BUN_DEFAULT_INTERACTIVE_OK`, then `/quit` exits 0. The displayed model
  stays Core Potassium; no fallback occurs. Auth files remain empty.
- New Node/Bun version/help/model-list checks pass. Product GPT-6 Luna and
  staging Haiku 5.5 print checks also pass on both rebuilt runtimes without
  fallback. The new packed document schema passes the preview GPT-6 Luna API
  again: HTTP 200, expected reply, stop, zero tool calls.
- Harness: `/tmp/cd1763-default-release-smoke.mjs`; artifacts:
  `/tmp/linc-cd1763-default-artifacts.THIEy0`; installed bundle:
  `/tmp/linc-cd1763-default-install.FH2Tzu`. Credentials are used in memory only.
  No production config, route, key, snapshot or version pin is changed.

## Catalog review

Exported-object comparison against 0.79.25: chat **1,438 → 1,465**,
**38 added, 11 removed, 63 retained entries changed**; image **59 → 61**,
**two added, none removed or changed**. The generator is unchanged.

All added/changed chat prices, context limits and output limits match the
captured source feeds under the existing generator's normalization and source
selection. Changed models.dev input modalities and reasoning flags also match
the feed. OpenCode Go Qwen3.7 Plus and Qwen3.8 Max switch from OpenAI-compatible
completions to Anthropic Messages because their captured upstream SDK metadata
now declares `@ai-sdk/anthropic`. The [official OpenCode Go endpoint table](https://docs.opencode.ai/docs/go/#endpoints)
independently confirms both use `https://opencode.ai/zen/go/v1/messages` and that
SDK. The Anthropic SDK adds `/v1/messages` to the generated base URL, so dropping
`/v1` from `baseUrl` avoids duplicating the path. This supports the mapping but is
**not authenticated live-turn certification**. On 2026-10-08, Dante explicitly
instructed: "You don't need to test quen." The live-test gate is waived for
exactly `opencode-go/qwen3.7-plus` and `opencode-go/qwen3.8-max` in this release.
Their unverified authenticated request/response behavior remains a documented
bounded risk, not a passed test. No Go credential or new subscription is needed.
Other release validation, runtime execution approval, and production rollout
gates are unchanged. No mocked test is represented as live certification.
Three Mistral aliases now advertise image
input. Anthropic Sonnet 4.5 context changes from 1M to 200k. Several other context
and output limits change; see the retained-entry table.

This catalog is a metadata snapshot, not proof of provider availability or
billing changes. Case.dev model discovery continues to use its live catalog.

### Captured sources

- [https://models.dev/api.json](https://models.dev/api.json), 2026-10-08T17:47:27.290Z; SHA-256 `b0e961208f8d5b01e282d6a2fa711eee5d32e46883d07e26e964ac98c3d3cabc`.
- [https://openrouter.ai/api/v1/models](https://openrouter.ai/api/v1/models), 2026-10-08T17:47:27.744Z; SHA-256 `f68b65618a0c51ced4286fc7f36b3f81eaa8bfa37f60431f82484756f2af5066`.
- [https://openrouter.ai/api/v1/models?output_modalities=image](https://openrouter.ai/api/v1/models?output_modalities=image), 2026-10-08T17:47:28.419Z; SHA-256 `08ee55dd51fd9aa6b913c894af275460c2786960fc1a28bd98b7f74c781e41aa`.
- [https://ai-gateway.vercel.sh/v1/models](https://ai-gateway.vercel.sh/v1/models), 2026-10-08T17:47:27.903Z; SHA-256 `a15dd86760ee9a43bfae3dd80faeb80f90f15a6abade923f1f00669d8db97d84`.
- [https://integrate.api.nvidia.com/v1/models](https://integrate.api.nvidia.com/v1/models), 2026-10-08T17:47:27.444Z; SHA-256 `2e7d19e2a7d4d8602a2b039de78b4af3e8b45920d34f50393947e53457d6849d`.

### Chat additions

- `amazon-bedrock/anthropic.claude-haiku-5-5`
- `amazon-bedrock/au.anthropic.claude-haiku-5-5`
- `amazon-bedrock/eu.anthropic.claude-haiku-5-5`
- `amazon-bedrock/eu.anthropic.claude-sonnet-5-5`
- `amazon-bedrock/global.anthropic.claude-haiku-5-5`
- `amazon-bedrock/global.zai.glm-5.3`
- `amazon-bedrock/jp.anthropic.claude-haiku-5-5`
- `amazon-bedrock/us.anthropic.claude-haiku-5-5`
- `amazon-bedrock/us.anthropic.claude-sonnet-5-5`
- `amazon-bedrock/us.zai.glm-5.3`
- `anthropic/claude-haiku-5-5`
- `cloudflare-ai-gateway/claude-sonnet-5.5`
- `cloudflare-ai-gateway/gpt-6.1-sol`
- `github-copilot/claude-haiku-5.5`
- `mistral/codestral-2508`
- `mistral/glm-5-2`
- `mistral/labs-leanstral-1-5-1`
- `mistral/ministral-14b-2512`
- `mistral/ministral-3b-2512`
- `mistral/ministral-8b-2512`
- `mistral/mistral-large-4`
- `mistral/voxtral-small-2507`
- `opencode/claude-haiku-5-5`
- `opencode/exo-free`
- `opencode/mistral-large-4`
- `opencode/step-5-preview-free`
- `opencode-go/claude-haiku-5-5`
- `opencode-go/space-bunny`
- `opencode-go/step-5-preview-free`
- `openrouter/anthropic/claude-haiku-5.5`
- `openrouter/anthropic/claude-haiku-5.5:batch`
- `openrouter/google/gemini-nano-banana-2.1`
- `openrouter/inclusionai/ling-3.0-flash-sante`
- `openrouter/mistralai/mistral-large-4-0`
- `openrouter/stepfun/step-5-preview`
- `vercel-ai-gateway/anthropic/claude-haiku-5.5`
- `vercel-ai-gateway/mistral/mistral-large-4`
- `vercel-ai-gateway/stealth/glyph-cluster`

### Catalog removals

All 11 removed entries are absent from the respective captured tool-capable
feed. None is a current `defaultModelPerProvider` selection. Installed-bundle
verification exercises all 11 missing IDs: saved defaults select an available
model (currently without a warning), while restored sessions return a visible
"Could not restore model ... model no longer exists ... Using ..." fallback
message. The expanded 43-test model-resolver suite passes, including saved-default
and session fallback regressions. An explicit `--provider` / `--model` selection
may be retained as a custom ID with a warning and can still fail at the provider;
that case requires choosing a currently served model. No named replacement or
migration shim is introduced. Local exhaustive check:
`/tmp/cd1763-retired-model-smoke.mjs` (11 default fallbacks, 11 session messages,
zero provider calls).

- `opencode/fledge-alpha-free`
- `opencode-go/space-bunny-free`
- `openrouter/inclusionai/ling-3.0-flash-sante:free`
- `openrouter/kwaipilot/kat-coder-pro-v2.5`
- `openrouter/qwen/qwen3.8-27b:free`
- `openrouter/sao10k/l3.1-euryale-70b`
- `openrouter/stealth/space-bunny-alpha`
- `vercel-ai-gateway/deepseek/deepseek-v3.1-terminus`
- `vercel-ai-gateway/inclusionai/ling-3.0-flash-sante-free`
- `vercel-ai-gateway/moonshotai/kimi-k2-thinking`
- `vercel-ai-gateway/stepfun/step-3.5-flash`

### Retained entries

Prices are USD per million tokens, listed as input / output / cache-read /
cache-write. Limits are the captured generator output, not live inference tests.

| Model | Changed fields | Prices | Context / output |
| --- | --- | --- | --- |
| `amazon-bedrock/anthropic.claude-sonnet-5-5` | cost | 2 / 10 / 0.1 / 2.5 | 1000000 / 128000 |
| `amazon-bedrock/global.anthropic.claude-sonnet-5-5` | cost | 2 / 10 / 0.1 / 2.5 | 1000000 / 128000 |
| `anthropic/claude-sonnet-4-5` | contextWindow | 3 / 15 / 0.3 / 3.75 | 200000 / 64000 |
| `anthropic/claude-sonnet-4-5-20250929` | contextWindow | 3 / 15 / 0.3 / 3.75 | 200000 / 64000 |
| `anthropic/claude-sonnet-5-5` | cost | 2 / 10 / 0.1 / 2.5 | 1000000 / 128000 |
| `cloudflare-workers-ai/@cf/google/gemma-4-26b-a4b-it` | cost | 0.1 / 0.3 / 0.05 / 0 | 256000 / 16384 |
| `github-copilot/claude-sonnet-5.5` | cost | 2 / 10 / 0.1 / 2.5 | 1000000 / 128000 |
| `mistral/magistral-medium-latest` | input, contextWindow | 2 / 5 / 0 / 0 | 262144 / 16384 |
| `mistral/ministral-3b-latest` | input, contextWindow | 0.04 / 0.04 / 0 / 0 | 131072 / 128000 |
| `mistral/ministral-8b-latest` | input, contextWindow | 0.1 / 0.1 / 0 / 0 | 262144 / 128000 |
| `mistral/mistral-small-2603` | contextWindow | 0.15 / 0.6 / 0.015 / 0 | 262144 / 256000 |
| `mistral/mistral-small-latest` | contextWindow | 0.15 / 0.6 / 0.015 / 0 | 262144 / 256000 |
| `mistral/voxtral-small-latest` | contextWindow | 0.1 / 0.3 / 0 / 0 | 32768 / 32000 |
| `mistral/zai-glm-5-2` | contextWindow | 1.4 / 4.4 / 0.14 / 0 | 1048576 / 131072 |
| `mistral/zai-glm-5-3` | contextWindow | 1.4 / 4.4 / 0.14 / 0 | 1048576 / 131072 |
| `moonshotai/kimi-k3` | cost | 3 / 15 / 0.3 / 3 | 1048576 / 1048576 |
| `moonshotai-cn/kimi-k3` | cost | 3 / 15 / 0.3 / 3 | 1048576 / 1048576 |
| `opencode-go/qwen3.7-plus` | api, baseUrl, compat | 0.4 / 1.6 / 0.04 / 0.5 | 1000000 / 65536 |
| `opencode-go/qwen3.8-max` | api, baseUrl, compat | 2 / 6 / 0.25 / 2.5 | 1000000 / 131072 |
| `openrouter/anthropic/claude-sonnet-5.5` | cost | 2 / 10 / 0.1 / 2.5 | 1000000 / 128000 |
| `openrouter/anthropic/claude-sonnet-5.5:batch` | cost | 1 / 5 / 0.05 / 1.25 | 1000000 / 128000 |
| `openrouter/deepseek/deepseek-v3.1-terminus` | cost, maxTokens | 0.27 / 1 / 0 / 0 | 163840 / 147456 |
| `openrouter/deepseek/deepseek-v3.2` | cost, maxTokens | 0.259 / 0.42 / 0.135 / 0 | 163840 / 147456 |
| `openrouter/deepseek/deepseek-v4-flash` | cost, maxTokens | 0.0228 / 1.28 / 0.0228 / 0 | 1048576 / 943718 |
| `openrouter/deepseek/deepseek-v4-flash-0731` | cost | 0.0079 / 1.28 / 0.0079 / 0 | 1048576 / 943718 |
| `openrouter/deepseek/deepseek-v4-pro` | cost | 0.287274 / 0.574548 / 0.0239395 / 0 | 1048576 / 384000 |
| `openrouter/deepseek/deepseek-v4.1-flash` | cost | 0.3 / 1.2 / 0.006 / 0 | 1048576 / 943718 |
| `openrouter/google/gemma-4-26b-a4b-it` | cost | 0.09 / 0.3 / 0.05 / 0 | 262144 / 235929 |
| `openrouter/inclusionai/ling-3.0-flash-fin` | cost, maxTokens | 0.042 / 0.1232 / 0.0084 / 0 | 262144 / 32768 |
| `openrouter/meta-llama/llama-4-maverick` | cost | 0.1875 / 0.6525 / 0.05 / 0 | 1048576 / 16384 |
| `openrouter/meta/muse-glimmer-30b` | cost, maxTokens | 0.3 / 1.2 / 0.04 / 0 | 131072 / 16384 |
| `openrouter/moonshotai/kimi-k2-thinking` | cost, maxTokens | 0.6 / 2.5 / 0 / 0 | 262144 / 235929 |
| `openrouter/moonshotai/kimi-k2.6` | cost | 0.4375 / 2.45 / 0.1211 / 0 | 262144 / 235929 |
| `openrouter/moonshotai/kimi-k3` | cost | 0.99 / 14 / 0.66 / 0 | 1048576 / 943718 |
| `openrouter/nvidia/nemotron-3-nano-30b-a3b` | cost | 0.06 / 0.24 / 0 / 0 | 262144 / 235929 |
| `openrouter/nvidia/nemotron-3-ultra-550b-a55b` | cost, maxTokens | 0.5 / 2.2 / 0.1 / 0 | 262144 / 16384 |
| `openrouter/nvidia/nemotron-3.5-lightning` | cost, maxTokens | 0.049 / 0.14 / 0.0245 / 0 | 262144 / 131072 |
| `openrouter/openai/gpt-5.6-sol-pro` | cost | 2 / 10 / 0.2 / 2.5 | 1050000 / 128000 |
| `openrouter/qwen/qwen3-235b-a22b-2507` | cost, maxTokens | 0.09 / 0.55 / 0 / 0 | 262144 / 16384 |
| `openrouter/qwen/qwen3-30b-a3b-instruct-2507` | cost, maxTokens | 0.1 / 0.3 / 0 / 0 | 262144 / 235929 |
| `openrouter/qwen/qwen3-next-80b-a3b-instruct` | cost, maxTokens | 0.09 / 1.1 / 0 / 0 | 262144 / 16384 |
| `openrouter/qwen/qwen3-next-80b-a3b-thinking` | maxTokens | 0.15 / 1.2 / 0 / 0 | 262144 / 32768 |
| `openrouter/qwen/qwen3.5-27b` | cost, maxTokens | 0.26 / 2.6 / 0 / 0 | 262144 / 81920 |
| `openrouter/qwen/qwen3.5-397b-a17b` | cost, maxTokens | 0.45 / 3 / 0.22 / 0 | 262144 / 81920 |
| `openrouter/qwen/qwen3.6-27b` | cost, maxTokens | 0.3 / 2 / 0.03 / 0 | 262144 / 65536 |
| `openrouter/qwen/qwen3.8-27b` | cost | 0.425 / 2.55 / 0.085 / 0.53125 | 1000000 / 131072 |
| `openrouter/thinkingmachines/inkling` | cost, maxTokens | 1 / 4.05 / 0.17 / 0 | 524288 / 471859 |
| `openrouter/z-ai/glm-4.6v` | cost | 0.3 / 0.9 / 0.055 / 0 | 131072 / 32768 |
| `openrouter/z-ai/glm-5.1` | cost, maxTokens | 0.966 / 3.036 / 0.1794 / 0 | 204800 / 128000 |
| `openrouter/z-ai/glm-5.2` | cost, maxTokens | 0.03 / 10 / 0.03 / 0 | 1048576 / 131072 |
| `openrouter/z-ai/glm-5.3` | cost, maxTokens | 0.1 / 4.2 / 0.048 / 0 | 1048576 / 943718 |
| `openrouter/~anthropic/claude-haiku-latest` | cost, contextWindow, maxTokens | 0.1 / 0.5 / 0.01 / 0.125 | 1000000 / 128000 |
| `openrouter/~anthropic/claude-sonnet-latest` | cost | 2 / 10 / 0.1 / 2.5 | 1000000 / 128000 |
| `openrouter/~deepseek/deepseek-flash-latest` | cost | 0.0283 / 1 / 0.01 / 0 | 1048576 / 943718 |
| `openrouter/~deepseek/deepseek-pro-latest` | cost | 0.1271 / 8 / 0.0953 / 0 | 1048576 / 393216 |
| `openrouter/~deepseek/deepseek-v4-flash-latest` | cost | 0.00632 / 0.610116 / 0.00632 / 0 | 1048576 / 943718 |
| `openrouter/~moonshotai/kimi-latest` | cost | 0.62 / 13 / 0.45 / 0 | 1048576 / 943718 |
| `openrouter/~z-ai/glm-flash-latest` | cost | 0.032 / 3.916611 / 0.02 / 0 | 1048576 / 943718 |
| `openrouter/~z-ai/glm-latest` | cost | 0.06 / 12 / 0.0558 / 0 | 1048576 / 131072 |
| `vercel-ai-gateway/anthropic/claude-sonnet-5.5` | cost | 2 / 10 / 0.1 / 2.5 | 1000000 / 128000 |
| `vercel-ai-gateway/arcee-ai/trinity-large-thinking` | cost | 0.25 / 0.8 / 0 / 0 | 262100 / 80000 |
| `vercel-ai-gateway/inclusionai/ling-3.0-flash-sante` | cost | 0.075 / 0.22 / 0.015 / 0 | 256000 / 32000 |
| `vercel-ai-gateway/poolside/laguna-s-2.1` | cost | 0.09 / 0.18 / 0.009 / 0 | 1000000 / 131072 |

### Image additions

- `openrouter/google/gemini-nano-banana-2.1`
- `openrouter/tencent/hy-image-v3.5-preview`

Both advertise image output in the captured image feed and their generated
prices match that feed.

## Publication and rollout gates

Candidate tarball SHA-256:
`080f4a8548073f637b348ef759858cc3dda1ec0238d5b66e4d5f3acb1c9befd3`.
macOS ARM64 archive SHA-256:
`e74e4d062deb0b5fad8b946468b9063a44a3eace7699dfa31499886927e988cf`.
Final local artifacts are under `/tmp/linc-cd1763-final-artifacts.GLs9HD`.
Captured catalog sources and original evidence remain under
`/tmp/linc-cd1763-release-artifacts.uGCLKg`. These are temporary local artifacts,
not durable published or CI artifacts.

The final release-note repack was installed into a new empty directory. Compared
with the live-certified default-fix candidate, all 15,335 installed files and all
929 extracted binary-archive files were checked: only `CHANGELOG.md` differs.
Runtime JS, dependencies, resources and the compiled Bun executable are
byte-identical, so the live results above apply to the final runtime payload.
Final Node/Bun version and help checks pass; unauthenticated model listing
correctly reports no available models. This metadata-only repack did not perform
new authenticated provider tests, including the two waived Qwen tests.

Human review, a merge commit and a human publishing-tag push are required.
The agent does not merge, enqueue, publish npm, or push a release tag.

**Release review:** standalone-default and product live smokes above are green.
The only waived live tests are the two OpenCode Go Qwen routes specified above,
at Dante's explicit instruction. Final release-note preparation is complete.
This candidate can proceed to human review once checks pass; this is not an
approval, merge, publication or product-cutover claim.

After npm/binary publication: reviewed Case.dev preview version-pin update,
candidate snapshot validation, then exact internal-org MCP acceptance covering
manifest-backed custom skill loading, create/edit/delete, CMAdmin assignments,
document delivery, isolation, revocation, persistent sessions and rollback.
The backend upstream-status fix also needs the appropriate production release
before a staging product that calls the production API can exercise it.
Production MCP rollout flags and shared snapshot pointers are unchanged here.
