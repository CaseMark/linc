# Linc 0.79.28 release verification

Tracked in [CD-1795](https://linear.app/casemarkai/issue/CD-1795/release-linc-07928-and-update-the-casedev-preview-pin). Base: main `401a848e8d3a9fb1f72a49be726937ef61267abf`.
Only `@casemark/linc` changes to 0.79.28; bundled pi versions/ranges remain 0.79.10. The reviewed 0.79.27 preparation was never published; its local tag and immutable changelog section are untouched. This release includes #91, #93 and #94.

## Changelog audit — 2026-10-13

The owner explicitly authorized this audit. All implementation commits since both local v0.79.27 and published v0.79.26 are covered: #91 runtime-image transport and timeout/concurrency handling in the existing 0.79.27 Fixed entry; #93 trusted template filling plus pinned-descriptor reads, schema validation and field-name-only audit; #94 the canonical empty APA bibliography compatibility exception. All affect coding-agent only. No missing entries or cross-package duplication were found. ai/agent/tui Unreleased sections and released sections are unchanged. Release/merge bookkeeping and generated catalog-only changes were excluded from the commit-entry audit. The proposed New Features highlight awaits owner confirmation; it is not added without approval.

## Local candidate validation

- Node 22.22.2 clean install with lifecycle scripts disabled; full build, full check and publish dry-run pass. Dependency versions/allowances are unchanged; lockfile/shrinkwrap changes are only Linc version fields.
- Installed tarball is a genuine outside-repo 0.79.28 install with bundled CaseMark pi builds at 0.79.10. Shipped runtime-image/SDK JS hashes match the build; installed chat/image catalogs match audited sources. Version/help pass on Node and macOS ARM64 Bun 1.3.4; release CI uses its pinned Bun and builds the other platforms. Installed production dependency audit has zero findings.
- Installed synthetic 30-image check passes: bounded four-upload concurrency, order/history preservation, URL reuse and fresh-helper behavior. This is not live image recognition.
- The exact retained fictional QA Word template fills all three fields through the installed native tool; its 16 non-body ZIP parts are byte-identical. Source SHA-256 `128b166f7c60373dc599a4a355c13089a980ad43dfe77656dc6d6057d5999de5`. This is not deployed runtime/View/Download acceptance.
- Full offline suite passes: 2,817 tests passed; 827 credential/platform-dependent tests skipped. The first run hit the previously observed footer reftable polling timeout; its isolated eight tests pass unchanged. A subsequent run was contaminated by overlapping local packaging cleanup (missing transient yaml paths), so it is not accepted as product evidence. The accepted full suite ran after packaging cleanup completed, with no package mutations, no test exclusions added and no product/test source edits. The wrapper redirects only test.sh auth paths and uses a credential-free child environment; live user auth files are untouched.
- Live Node/Bun model listing, print and interactive replies remain pending: existing Vercel CLI and connector access to PanelWorks environment variables is denied (403). No credentials are printed or written to release artifacts, and no balance or permissions are modified. This keeps the release draft; no waiver is inferred.

## Catalog review

Relative to reviewed local v0.79.27: 1453 → 1507 chat entries; 54 added, 0 removed, 11 retained metadata changes. Image catalog remains 61 entries, unchanged. No retained chat entry changes its API or endpoint. Relative to published v0.79.26: 62 added, 20 removed and 48 changed. All 20 removals were previously documented in 0.79.27 and remain absent from the captured direct source feeds. There are no additional removals in 0.79.28. Generated catalogs are not hand-edited; source feeds are captured with hashes for review. Metadata availability is not authenticated certification of every provider route.

### Captured sources

- [https://openrouter.ai/api/v1/models](https://openrouter.ai/api/v1/models), 2026-10-13T16:17:11.944Z; SHA-256 `ed3f1c5eaa69eaf33f739d17ed973a93457a65b0cd9acc0ecd78b77048a3132b`.
- [https://integrate.api.nvidia.com/v1/models](https://integrate.api.nvidia.com/v1/models), 2026-10-13T16:17:10.760Z; SHA-256 `2e7d19e2a7d4d8602a2b039de78b4af3e8b45920d34f50393947e53457d6849d`.
- [https://ai-gateway.vercel.sh/v1/models](https://ai-gateway.vercel.sh/v1/models), 2026-10-13T16:17:12.066Z; SHA-256 `87ccc4863a644b3c80450c0b7527bf9731de1883217a39a738e8d23e24460cad`.
- [https://openrouter.ai/api/v1/models?output_modalities=image](https://openrouter.ai/api/v1/models?output_modalities=image), 2026-10-13T16:17:13.721Z; SHA-256 `051a7fc1446e4fc76a728413e80a3c92c071118396267731aef81d1aa0dbd292`.
- [https://models.dev/api.json](https://models.dev/api.json), 2026-10-13T16:17:10.617Z; SHA-256 `63cfd73f4efade5e7ea644abf5a1493a564399c7aa6967dbbf53f904e0cab34c`.

### Additions since 0.79.27

- `opencode/cat-jam-free`
- `openrouter/google/gemini-4-argon`
- `vercel-ai-gateway/anthropic/claude-fable-5-batch`
- `vercel-ai-gateway/anthropic/claude-fable-5.1-batch`
- `vercel-ai-gateway/anthropic/claude-haiku-4.5-batch`
- `vercel-ai-gateway/anthropic/claude-haiku-5.5-batch`
- `vercel-ai-gateway/anthropic/claude-opus-4.5-batch`
- `vercel-ai-gateway/anthropic/claude-opus-4.6-batch`
- `vercel-ai-gateway/anthropic/claude-opus-4.7-batch`
- `vercel-ai-gateway/anthropic/claude-opus-4.8-batch`
- `vercel-ai-gateway/anthropic/claude-opus-5-batch`
- `vercel-ai-gateway/anthropic/claude-opus-5.5-batch`
- `vercel-ai-gateway/anthropic/claude-sonnet-4.5-batch`
- `vercel-ai-gateway/anthropic/claude-sonnet-4.6-batch`
- `vercel-ai-gateway/anthropic/claude-sonnet-5-batch`
- `vercel-ai-gateway/anthropic/claude-sonnet-5.5-batch`
- `vercel-ai-gateway/deepseek/deepseek-v4.1-flash-fast`
- `vercel-ai-gateway/google/gemini-2.5-flash-batch`
- `vercel-ai-gateway/google/gemini-2.5-flash-lite-batch`
- `vercel-ai-gateway/google/gemini-2.5-pro-batch`
- `vercel-ai-gateway/google/gemini-3-flash-batch`
- `vercel-ai-gateway/google/gemini-3.1-flash-lite-batch`
- `vercel-ai-gateway/google/gemini-3.1-pro-preview-batch`
- `vercel-ai-gateway/google/gemini-3.5-flash-batch`
- `vercel-ai-gateway/google/gemini-3.5-flash-lite-batch`
- `vercel-ai-gateway/google/gemini-3.6-flash-batch`
- `vercel-ai-gateway/google/gemini-3.7-flash-batch`
- `vercel-ai-gateway/google/gemini-4-argon`
- `vercel-ai-gateway/openai/gpt-4.1-batch`
- `vercel-ai-gateway/openai/gpt-4.1-mini-batch`
- `vercel-ai-gateway/openai/gpt-4.1-nano-batch`
- `vercel-ai-gateway/openai/gpt-4o-batch`
- `vercel-ai-gateway/openai/gpt-4o-mini-batch`
- `vercel-ai-gateway/openai/gpt-5-batch`
- `vercel-ai-gateway/openai/gpt-5-mini-batch`
- `vercel-ai-gateway/openai/gpt-5-nano-batch`
- `vercel-ai-gateway/openai/gpt-5-pro-batch`
- `vercel-ai-gateway/openai/gpt-5.2-batch`
- `vercel-ai-gateway/openai/gpt-5.4-batch`
- `vercel-ai-gateway/openai/gpt-5.4-mini-batch`
- `vercel-ai-gateway/openai/gpt-5.4-nano-batch`
- `vercel-ai-gateway/openai/gpt-5.5-batch`
- `vercel-ai-gateway/openai/gpt-5.5-pro-batch`
- `vercel-ai-gateway/openai/gpt-5.6-luna-batch`
- `vercel-ai-gateway/openai/gpt-5.6-sol-batch`
- `vercel-ai-gateway/openai/gpt-5.6-terra-batch`
- `vercel-ai-gateway/openai/gpt-6-astra-batch`
- `vercel-ai-gateway/openai/gpt-6-luna-batch`
- `vercel-ai-gateway/openai/gpt-6-sol-batch`
- `vercel-ai-gateway/openai/gpt-6.1-sol-batch`
- `vercel-ai-gateway/spacexai/grok-4.20-multi-agent-batch`
- `vercel-ai-gateway/spacexai/grok-4.20-non-reasoning-batch`
- `vercel-ai-gateway/spacexai/grok-4.20-reasoning-batch`
- `vercel-ai-gateway/spacexai/grok-4.3-batch`

### Retained changes since 0.79.27

Prices are USD per million tokens (input / output / cache read / cache write).

| Model | Changed fields | Current prices | Context / output |
| --- | --- | --- | --- |
| `openrouter/deepseek/deepseek-v4-flash` | cost, maxTokens | 0.091 / 0.182 / 0.0182 / 0 | 1048576 / 943717 |
| `openrouter/deepseek/deepseek-v4-pro` | cost | 0.436044 / 0.872088 / 0.036337 / 0 | 1048576 / 384000 |
| `openrouter/deepseek/deepseek-v4.1-flash` | cost, maxTokens | 0.0441 / 0.63 / 0.0054 / 0 | 1048576 / 943718 |
| `openrouter/google/gemma-4-26b-a4b-it` | cost | 0.09 / 0.3 / 0.05 / 0 | 262144 / 235929 |
| `openrouter/meta-llama/llama-3.3-70b-instruct` | cost, maxTokens | 0.59 / 0.79 / 0.295 / 0 | 131072 / 32768 |
| `openrouter/minimax/minimax-m2.7` | cost, maxTokens | 0.3 / 1.2 / 0.06 / 0 | 204800 / 131072 |
| `openrouter/openai/gpt-oss-120b` | cost, maxTokens | 0.15 / 0.6 / 0.075 / 0 | 131072 / 65536 |
| `openrouter/z-ai/glm-5.3-flash` | cost | 0.0261 / 0.9 / 0.0108 / 0 | 1048576 / 943718 |
| `openrouter/~deepseek/deepseek-flash-latest` | cost | 0.0441 / 0.63 / 0.0054 / 0 | 1048576 / 943718 |
| `openrouter/~deepseek/deepseek-v4-flash-latest` | cost | 0.0144 / 0.576 / 0.0108 / 0 | 1048576 / 943718 |
| `openrouter/~z-ai/glm-flash-latest` | cost | 0.0261 / 0.9 / 0.0108 / 0 | 1048576 / 943718 |

### Removals relative to published 0.79.26

- `openrouter/qwen/qwen-plus-2025-07-28`
- `openrouter/qwen/qwen3-235b-a22b`
- `openrouter/qwen/qwen3-30b-a3b-thinking-2507`
- `openrouter/qwen/qwen3-8b`
- `openrouter/qwen/qwen3-coder-plus`
- `openrouter/qwen/qwen3-max`
- `openrouter/qwen/qwen3-max-thinking`
- `openrouter/qwen/qwen3-vl-235b-a22b-thinking`
- `openrouter/qwen/qwen3-vl-32b-instruct`
- `openrouter/qwen/qwen3-vl-8b-thinking`
- `openrouter/qwen/qwen3.6-max-preview`
- `vercel-ai-gateway/alibaba/qwen-3.6-max-preview`
- `vercel-ai-gateway/alibaba/qwen3-235b-a22b-thinking`
- `vercel-ai-gateway/alibaba/qwen3-coder-plus`
- `vercel-ai-gateway/alibaba/qwen3-max`
- `vercel-ai-gateway/alibaba/qwen3-max-preview`
- `vercel-ai-gateway/alibaba/qwen3-vl-235b-a22b-instruct`
- `vercel-ai-gateway/alibaba/qwen3-vl-thinking`
- `vercel-ai-gateway/anthropic/claude-3-haiku`
- `vercel-ai-gateway/anthropic/claude-opus-4`

## Publication and cutover

Human review/merge commit and a human publishing-tag push remain required. No existing tag is moved. npm publication must be verified before merging the Case.dev 0.79.28 pin and baking a candidate snapshot. Final live retained-template fill/upload/View/Download, authorized CMAdmin assignment/removal and two-real-tenant positive/negative checks remain acceptance gates. Production MCP activation remains off; a successful local/package check is not a customer-cutover claim.
