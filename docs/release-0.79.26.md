# Linc 0.79.26 release verification

Tracked in [CD-1763](https://linear.app/casemarkai/issue/CD-1763).
Base: main `7991148987a7e4498cc9a9bb91764387114d78ed`.
Only `@casemark/linc` becomes 0.79.26. The three bundled pi packages and
their dependency ranges remain 0.79.10. This document describes an unpublished
release candidate, not live PanelWorks acceptance or production activation.

## Changelog audit — 2026-10-08

Dante authorized the repository's `/cl` audit to be performed by the agent.
The only implementation change since 0.79.25 is [#89](https://github.com/CaseMark/linc/pull/89):
the opt-in native document tool advertises a portable filename regex instead of
unsupported lookaround, while its runtime validation still rejects trailing
line terminators and unsafe filenames before any write. Added unit cases and a
faux-provider MCP-extension regression cover that boundary.

The audit found one missing coding-agent Fixed entry, now included. No new
feature or cross-package duplication is required. Release housekeeping is
excluded; existing ai/agent/tui Unreleased entries are unchanged. Previously
released Linc sections are unchanged.

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
- **Release blocker:** authenticated print-mode requests using the existing
  Vercel preview `CASEMARK_API_KEY` fail with HTTP 401 on both Node and Bun.
  A direct synthetic streaming request to the preview LLM endpoint also returns
  HTTP 401 (`LLM_ERROR`); catalog enumeration returns 200, which alone does not
  certify inference authentication. The endpoint's authentication/provider
  failure has not been attributed to a specific credential or root cause.
  Real interactive model completion is therefore not certified. The release
  stays draft unless these smokes pass or Theodore explicitly accepts the risk.
  No key rotation or production credential is used.
- Initial print checks accidentally inherited offline mode and unrelated
  provider configuration; their successful markers are excluded from release
  acceptance. The corrected checks allow only preview Case.dev authentication,
  isolate config, and do not force a provider/model. Case.dev automatically
  selects `casemark-core` / `casemark/core-large` in this captured preview catalog.

## Catalog review

Exported-object comparison against 0.79.25: chat **1,438 → 1,465**,
**38 added, 11 removed, 63 retained entries changed**; image **59 → 61**,
**two added, none removed or changed**. The generator is unchanged.

All added/changed chat prices, context limits and output limits match the
captured source feeds under the existing generator's normalization and source
selection. Changed models.dev input modalities and reasoning flags also match
the feed. OpenCode Go Qwen3.7 Plus and Qwen3.8 Max switch from OpenAI-compatible
completions to Anthropic Messages because their captured upstream SDK metadata
now declares `@ai-sdk/anthropic`; this is source metadata, not a live turn
certification for those providers. Three Mistral aliases now advertise image
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
feed. Existing saved selections of these exact IDs require a currently listed
alternative. No named replacement or migration shim is introduced.

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
`f9f7599e10bdcc47d2eed0d9f34fb6bf91e41046f58967a1f282f9db952085ee`.
macOS ARM64 archive SHA-256:
`da2b5b175da5df6811637a5d3e5f5195b6de95198c263956594a145ae512d455`.
Local evidence is under `/tmp/linc-cd1763-release-artifacts.uGCLKg`; the passing
suite log is `/tmp/cd1763-release-tests-sequential.log`. These are temporary
local artifacts, not durable published or CI artifacts.

Human review, a merge commit and a human publishing-tag push are required.
The agent does not merge, enqueue, publish npm, or push a release tag.

After npm/binary publication: reviewed Case.dev preview version-pin update,
candidate snapshot validation, then exact internal-org MCP acceptance covering
manifest-backed custom skill loading, create/edit/delete, CMAdmin assignments,
document delivery, isolation, revocation, persistent sessions and rollback.
The backend upstream-status fix also needs the appropriate production release
before a staging product that calls the production API can exercise it.
Production MCP rollout flags and shared snapshot pointers are unchanged here.
