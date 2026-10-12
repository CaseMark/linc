# Linc 0.79.27 release verification

Tracked in [CD-1795](https://linear.app/casemarkai/issue/CD-1795/release-linc-07927-and-update-the-casedev-preview-pin); implementation [CD-1780](https://linear.app/casemarkai/issue/CD-1780/linc-deliver-runtime-images-through-renewable-presigned-urls).
Base: main `7dedb56a8eefdee5fe6a56d90213266b7914fd33`.
Only `@casemark/linc` becomes 0.79.27. The bundled pi workspaces and their dependency ranges stay at 0.79.10.

## Changelog audit — 2026-10-12

Audit of all commits since v0.79.26 finds two implementation commits in [#91](https://github.com/CaseMark/linc/pull/91): runtime-image transport and its endpoint/concurrency fixes. Both affect coding-agent only and are covered by its Fixed entry; PR attribution is added. There are no missing cross-package entries. Existing ai/agent/tui Unreleased sections and all previously released Linc sections are preserved. Merge/release bookkeeping is excluded. No separate New Features entry is proposed: this release documents the existing request-history fix in Fixed.

## Verification

- Node 22.22.2 clean `npm ci --ignore-scripts`, full build, `npm run check` (including shrinkwrap/browser checks), offline suite and publish dry run pass.
- Offline tests use the repository's `test.sh` logic with only its auth-file paths redirected to a temporary directory. A minimal child environment removes live-provider credentials; the user's live auth files are untouched.
- Lockfile/shrinkwrap diffs change only Linc version fields. No dependency upgrades, lifecycle-script allowances or upstream package version changes are included.
- Full offline suite: **2,774 passed, 827 skipped**. Provider tests are intentionally skipped without credentials; bundle tests run sequentially after other coding-agent tests.
- The actual tarball installs into an empty directory with `--omit=dev --ignore-scripts`. Installed Linc is 0.79.27, all bundled pi packages are 0.79.10, and installed runtime-image/SDK JavaScript hashes match the workspace build. Installed chat/image catalogs exactly match the audited generated sources. Its runtime dependency audit has **zero findings**.
- The installed helper passes a controlled 30-image check: four concurrent uploads, preserved image order/native history, URL reuse without another upload, trailing-slash endpoint support and a fresh helper after restart. This uses a synthetic service fixture and is not live provider recognition.
- The macOS ARM64 Bun archive builds and reports 0.79.27 outside the repository. Node and Bun version/help/authenticated model listing pass. Other-platform artifacts require release CI.
- **Live acceptance is blocked by preview funding:** the existing C3 preview `CASE_API_KEY` authenticates and lists models, but the installed Node default `casemark-core` / `casemark/core-potassium` completion returns HTTP 402. A direct synthetic request with only 32 output tokens also returns 402 / Payment Required. Controlled PTY startup selects that default but produces no successful assistant reply. These are failures, not live-smoke passes; Bun live turns and final packaged image-recognition/renewal/cache acceptance remain unverified. No balance, key or production configuration is changed. A funded preview credential or an explicit owner waiver is required before publication; the release PR remains draft.

## Catalog review

Semantic comparison against 0.79.26: chat **1465 → 1453**, **8 added, 20 removed, 47 retained entries changed**. Image **61 → 61**, no entries added, removed or changed. The generator is unchanged; generated ordering/formatting is not counted as semantic change. No retained model changes transport API or endpoint.

### Captured sources

- [https://openrouter.ai/api/v1/models](https://openrouter.ai/api/v1/models), 2026-10-12T19:22:43.391Z; SHA-256 `cb55da9a61e76e295192bacc5b05c93706ccd35f78b3561e6191c5df95b5548f`.
- [https://integrate.api.nvidia.com/v1/models](https://integrate.api.nvidia.com/v1/models), 2026-10-12T19:22:42.257Z; SHA-256 `2e7d19e2a7d4d8602a2b039de78b4af3e8b45920d34f50393947e53457d6849d`.
- [https://ai-gateway.vercel.sh/v1/models](https://ai-gateway.vercel.sh/v1/models), 2026-10-12T19:22:43.775Z; SHA-256 `c9b05a208ddf31919c157905a2f25da3639d41be7fa6cbae36adfdc9ba958f74`.
- [https://openrouter.ai/api/v1/models?output_modalities=image](https://openrouter.ai/api/v1/models?output_modalities=image), 2026-10-12T19:22:44.000Z; SHA-256 `c7e9ce6f26361bee589153a2b8ff09e089a665dcb8437471432f51ee65495f4d`.
- [https://models.dev/api.json](https://models.dev/api.json), 2026-10-12T19:22:42.130Z; SHA-256 `a0a08367b6f1edd5fc7411b7929fdef226f9be4b7835177cdf1629db909237de`.

### Chat additions

- `cloudflare-ai-gateway/claude-haiku-5.5`
- `huggingface/MiniMaxAI/MiniMax-M1-80k`
- `huggingface/Qwen/Qwen3-VL-30B-A3B-Instruct`
- `openrouter/meta/muse-wonder`
- `openrouter/openai/gpt-6.1-sol-pro:batch`
- `openrouter/openai/gpt-6.1-sol:batch`
- `vercel-ai-gateway/callstack/apex`
- `vercel-ai-gateway/meta/muse-wonder-1.0`

### Catalog removals

These IDs no longer occur in the captured tool-capable source feeds. Users explicitly selecting one must choose a currently listed model. This is metadata availability, not proof that every remaining route serves live inference. No named replacement shim is added; Case.dev discovery remains live.

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

### Retained metadata changes

Prices are USD per million tokens (input / output / cache read / cache write). Limits come from the captured generator output. This is metadata validation, not authenticated certification of every provider.

| Model | Changed fields | Current prices | Context / output |
| --- | --- | --- | --- |
| `cloudflare-workers-ai/@cf/mistralai/mistral-small-3.1-24b-instruct` | input | 0.351 / 0.555 / 0 / 0 | 128000 / 128000 |
| `openrouter/deepseek/deepseek-chat` | cost, maxTokens | 0.32 / 0.89 / 0 / 0 | 163840 / 16384 |
| `openrouter/deepseek/deepseek-v3.2` | cost | 0.259 / 0.8 / 0.14 / 0 | 163840 / 147456 |
| `openrouter/deepseek/deepseek-v4-flash` | cost | 0.03 / 1.28 / 0.03 / 0 | 1048576 / 943718 |
| `openrouter/deepseek/deepseek-v4-flash-0731` | cost | 0.016 / 0.64 / 0.016 / 0 | 1048576 / 943718 |
| `openrouter/deepseek/deepseek-v4-pro` | cost | 0.41238 / 0.82476 / 0.034365 / 0 | 1048576 / 384000 |
| `openrouter/deepseek/deepseek-v4.1-flash` | cost, maxTokens | 0.15 / 0.6 / 0.003 / 0 | 1048576 / 393216 |
| `openrouter/google/gemma-4-26b-a4b-it` | cost | 0.0765 / 0.255 / 0.0425 / 0 | 262144 / 235929 |
| `openrouter/inclusionai/ling-3.1-flash` | maxTokens | 0 / 0 / 0 / 0 | 262144 / 235929 |
| `openrouter/meta-llama/llama-3.3-70b-instruct` | cost | 0.22 / 0.5 / 0.11 / 0 | 131072 / 16384 |
| `openrouter/meta-llama/llama-4-scout` | cost, maxTokens | 0.18 / 0.59 / 0 / 0 | 1310720 / 117964 |
| `openrouter/mistralai/mistral-nemo` | cost | 0.029 / 0.03 / 0 / 0 | 131072 / 16384 |
| `openrouter/moonshotai/kimi-k2-thinking` | cost, maxTokens | 0.6 / 2.5 / 0.15 / 0 | 262144 / 98304 |
| `openrouter/moonshotai/kimi-k2.6` | cost | 0.65 / 3.41 / 0.15 / 0 | 262144 / 235929 |
| `openrouter/moonshotai/kimi-k3` | cost | 0.73 / 10 / 0.55 / 0 | 1048576 / 943718 |
| `openrouter/nvidia/nemotron-3-ultra-550b-a55b` | cost, maxTokens | 0.6 / 2.4 / 0.12 / 0 | 262144 / 182520 |
| `openrouter/nvidia/nemotron-3.5-lightning` | cost, maxTokens | 0.07 / 0.2 / 0.04 / 0 | 262144 / 235929 |
| `openrouter/qwen/qwen3-14b` | contextWindow | 0.12 / 0.24 / 0 / 0 | 40960 / 16384 |
| `openrouter/qwen/qwen3-235b-a22b-thinking-2507` | cost, contextWindow, maxTokens | 0.45 / 3.5 / 0 / 0 | 128000 / 16384 |
| `openrouter/qwen/qwen3-30b-a3b` | contextWindow | 0.12 / 0.5 / 0 / 0 | 40960 / 16384 |
| `openrouter/qwen/qwen3-next-80b-a3b-instruct` | cost, maxTokens | 0.1 / 1.1 / 0.07 / 0 | 262144 / 235929 |
| `openrouter/qwen/qwen3-next-80b-a3b-thinking` | maxTokens | 0.15 / 1.2 / 0 / 0 | 262144 / 235929 |
| `openrouter/qwen/qwen3-vl-30b-a3b-thinking` | cost, maxTokens | 0.29 / 1 / 0 / 0 | 262144 / 235929 |
| `openrouter/qwen/qwen3-vl-8b-instruct` | cost, maxTokens | 0.25 / 0.75 / 0.12 / 0 | 262144 / 235929 |
| `openrouter/qwen/qwen3.5-35b-a3b` | cost, maxTokens | 0.08 / 0.75 / 0.04 / 0 | 262144 / 32768 |
| `openrouter/qwen/qwen3.5-397b-a17b` | cost, maxTokens | 0.55 / 3.5 / 0.225 / 0 | 262144 / 235929 |
| `openrouter/qwen/qwen3.6-27b` | cost, maxTokens | 0.32 / 3.2 / 0 / 0 | 262144 / 81920 |
| `openrouter/qwen/qwen3.6-35b-a3b` | cost, maxTokens | 0.1 / 0.95 / 0.1 / 0 | 262144 / 65536 |
| `openrouter/qwen/qwen3.8-27b` | cost, maxTokens | 0.04 / 2.3 / 0.0198 / 0 | 1000000 / 235929 |
| `openrouter/qwen/qwen3.8-flash` | cost | 0.15 / 0.47 / 0.016 / 0 | 1000000 / 131072 |
| `openrouter/qwen/qwen3.8-max-0902` | cost | 2 / 6 / 0.25 / 0 | 1000000 / 131072 |
| `openrouter/z-ai/glm-4.6` | cost, maxTokens | 0.5 / 2 / 0.1 / 0 | 204800 / 131072 |
| `openrouter/z-ai/glm-5.2` | cost, maxTokens | 0.06 / 7 / 0.059 / 0 | 1048576 / 943718 |
| `openrouter/z-ai/glm-5.3` | cost | 0.079 / 4.8 / 0.059 / 0 | 1048576 / 943718 |
| `openrouter/z-ai/glm-5.3-flash` | cost, maxTokens | 0.0232 / 1.2 / 0.0232 / 0 | 1048576 / 943718 |
| `openrouter/~deepseek/deepseek-flash-latest` | cost | 0.0336 / 1.188 / 0.0336 / 0 | 1048576 / 943718 |
| `openrouter/~deepseek/deepseek-pro-latest` | cost | 0.24948 / 0.74844 / 0.007938 / 0 | 1048576 / 393216 |
| `openrouter/~deepseek/deepseek-v4-flash-latest` | cost | 0.0128 / 0.768 / 0.0128 / 0 | 1048576 / 943718 |
| `openrouter/~moonshotai/kimi-latest` | cost | 0.73 / 10 / 0.55 / 0 | 1048576 / 943718 |
| `openrouter/~z-ai/glm-flash-latest` | cost | 0.0232 / 1.2 / 0.0232 / 0 | 1048576 / 943718 |
| `openrouter/~z-ai/glm-latest` | cost, maxTokens | 0.055 / 5 / 0.06 / 0 | 1048576 / 943718 |
| `vercel-ai-gateway/alibaba/qwen-3-235b` | reasoning | 0.22 / 0.88 / 0 / 0 | 262144 / 16384 |
| `vercel-ai-gateway/alibaba/qwen-3-32b` | cost | 0.15 / 0.6 / 0 / 0 | 128000 / 8192 |
| `vercel-ai-gateway/alibaba/qwen3-coder` | cost, maxTokens | 0.22 / 1.8 / 0.022 / 0 | 262144 / 32768 |
| `vercel-ai-gateway/alibaba/qwen3-vl-instruct` | cost, contextWindow, maxTokens | 0.2 / 0.88 / 0.11 / 0 | 262144 / 262144 |
| `vercel-ai-gateway/mistral/mistral-nemo` | cost, contextWindow, maxTokens | 0.029 / 0.03 / 0 / 0 | 131072 / 131072 |
| `vercel-ai-gateway/xiaomi/mimo-v2.6-flash` | cost | 0.14 / 0.28 / 0.0028 / 0 | 1048576 / 131072 |

## Local candidate artifacts

- `casemark-linc-0.79.27.tgz`: SHA-256 `c3aba40e4748dc57bfe28b3f3e03a69f8f4ece04264bd1a06525aaf1a311e0f2`.
- `binaries/pi-darwin-arm64.tar.gz`: SHA-256 `01e808b09efd98adb8eb767ab41f3375475d059aac576568783a35f5666c768d`.

These identify the validated local candidates. GitHub release workflows build platform artifacts and regenerate catalogs from live feeds.

## Publication and rollout

Human review, a release-PR merge commit and a human publishing-tag push are required by the repository instructions. Publishing uses the GitHub OIDC npm workflow. The Case.dev single-pin PR stays draft until npm publication is verified, then proceeds through preview snapshot validation and reviewed production promotion. URL expiry is not object deletion; age-based retention and delayed-replica reconciliation remain tracked separately in CD-1792.
