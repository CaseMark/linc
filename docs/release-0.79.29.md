# Linc 0.79.29 release verification

Tracked in [CD-1834](https://linear.app/casemarkai/issue/CD-1834/release-linc-07929-with-bounded-native-pdf-creation). Base: main `e2c8d8b31d7b5e7620faf88dc041e0028d86456c`.
Only `@casemark/linc` changes version. Bundled pi versions and dependency ranges remain 0.79.10.

## Owner-authorized changelog audit — 2026-10-15

The owner authorized an equivalent `/cl` audit on the merged main. All implementation commits since the published v0.79.28 tag were inspected: #96 clarifies page-marker citation guidance; #97 adds bounded native PDF creation, clear origin errors, PDF-version documentation/tests, the NVIDIA-only default correction and catalog-aware collection of a retired-model live suite. Coding-agent entries cover the shipped behavior; the AI Unreleased section records its test-only correction. Agent and TUI have no new implementation changes in this range. Existing released sections are preserved byte-for-byte relative to main.

The C3-119 entry was added to main's 0.79.28 section after the v0.79.28 tag. The source fix is first included in 0.79.29; the new entry makes that distinction explicit without changing existing release history again.

The owner separately approved CD-1837's test-only follow-ups in commits `4ecf6740` and `c959a3fe`: a typed historical cache-control fixture, exact-model membership guards on two live tests, and current-model selection for registry override coverage. All registry assertions remain, with no added registry skips. Runtime code, provider defaults and generated catalog generation logic are unchanged by those follow-ups.

## Validation status

- Node 22.22.2 ignore-scripts install, full build, full code check and publish dry-run pass. Lockfile and shrinkwrap changes are Linc version fields only; no dependency updates or new lifecycle allowances. Installed production dependency audit has zero findings; the development install reports pre-existing advisories and is not the shipped production closure.
- Full credential-stripped `./test.sh` passes: 2,865 passed, 827 credential/platform/model-dependent skipped. A local wrapper redirects only auth paths to isolated temporary directories and limits Vitest workers to two. All files/assertions/timeouts remain unchanged. Normal-concurrency attempts hit the existing macOS reftable watcher timeout and one session-runtime timeout; both unchanged isolated files pass (eight and nine tests respectively). The final accepted complete gate passes with no exclusions. This local concurrency setting is not committed or applied to CI.
- The actual external Node tarball install contains all three bundled pi builds at 0.79.10; shipped PDF/extension/model-resolver JS matches the build. Node and macOS ARM64 Bun 1.3.4 pass version/help, model listing, authenticated print completions and real interactive PTY completions with `casemark-core` / `casemark/core-potassium`, final `stopReason: stop`, and clean exit 0. Existing Casemark credentials remain in memory/child-process environment only, never artifacts, logs or public task links. Account metadata was checked with in-memory auth storage; no new login or key was created.
- The packed native PDF tool rejects unsupported table data and creates a real PDF through the authenticated production formatter using fictional text. PDF: 2,219 bytes, SHA-256 `76c927b2259e013b1762200ad540e629634a660cd7c17e9eb4bb916fddb6f405`; PDF 1.3, one A4 page, no JavaScript, mode 0600. Rendering confirms readable headings, body text, citations and uncertainty. This is a packed-tool/API smoke, not deployed esq-c3 upload/View/Download acceptance.

No publication, publishing tag push, deployment, global snapshot pointer change or org enrollment has occurred. Both production allowlists were re-read: Casemark remains the sole org, with API snapshot `linc-api-v63` and app revision `casemark-prod-20261014-v2`. Native PDF supports paragraphs/headings and standard-font characters only, not table/template/advanced-layout parity. After reviewed publication, the candidate image and scoped Casemark rollout still require live product PDF creation/upload/View/Download and execution-guard checks.

## Catalog review

Relative to published v0.79.28: chat catalog 1,507 → 1,508 (14 added, 13 removed, 31 retained entries changed); image catalog 61 → 59 (two removed, one name changed). No retained entry changes its API or endpoint. Every retained changed field and every removal was checked against the captured feeds and existing generator filters. Generated catalogs were not hand-edited. Metadata is not authenticated certification of provider availability.

NVIDIA requires both models.dev metadata and NVIDIA NIM membership. The removed Nemotron 3 Super ID still appears in the captured NIM list, but lacks eligible models.dev metadata; this is a catalog exclusion, not proof NVIDIA shut its endpoint down. OpenCode excludes entries marked deprecated. The NVIDIA default fix addresses Linc catalog validity only.

### Captured sources

| Source | Captured UTC | SHA-256 |
| --- | --- | --- |
| [https://models.dev/api.json](https://models.dev/api.json) | 2026-10-15T14:56:57.546Z | `407f9a50f5ca421ce8a387cf5c98205488c071db4041b3fc840b2cbd9f38f780` |
| [https://integrate.api.nvidia.com/v1/models](https://integrate.api.nvidia.com/v1/models) | 2026-10-15T14:56:57.708Z | `2da68136cacea2610cf95ac3e0df76a361764febef9edb23011ef3bd676a483c` |
| [https://openrouter.ai/api/v1/models](https://openrouter.ai/api/v1/models) | 2026-10-15T14:56:57.875Z | `4748e618ee8fd75ca6c78de3b8df54bc2ae57d6d491a961f5b51d25a3edc30bc` |
| [https://ai-gateway.vercel.sh/v1/models](https://ai-gateway.vercel.sh/v1/models) | 2026-10-15T14:56:58.018Z | `7f0195fb7bd1d58127dda6e1b56ae57e573560517106039ac59e4a304163f90c` |
| [https://openrouter.ai/api/v1/models?output_modalities=image](https://openrouter.ai/api/v1/models?output_modalities=image) | 2026-10-15T14:56:58.400Z | `e416c0929a5fb11ea972404c63ffda4addf7b1b6734881685ca914963ce3f93b` |

### Catalog additions

- `github-copilot/gemini-4-argon`
- `google/gemini-4-argon`
- `nvidia/nvidia/nemotron-3.5-super-vl-120b-a12b`
- `opencode/deepseek-v4.1-flash-free`
- `opencode/gemini-4-argon`
- `opencode-go/cat-jam-free`
- `opencode-go/gemini-4-argon-contributor`
- `openrouter/google/gemini-4-argon:batch`
- `openrouter/liquid/lfm-2.5-24b-a2b`
- `openrouter/openrouter/pareto-code`
- `openrouter/unbiased/pareto-26.9`
- `openrouter/~unbiased/pareto-latest`
- `vercel-ai-gateway/liquid/lfm2.5-24b-a2b`
- `vercel-ai-gateway/nvidia/nemotron-3.5-lightning-free`

### Catalog removals

Chat:

- `nvidia/moonshotai/kimi-k3`
- `nvidia/nvidia/nemotron-3-super-120b-a12b`
- `opencode/exo-free`
- `opencode/ling-3.0-flash-fin-free`
- `opencode/ling-3.1-flash-free`
- `opencode-go/deepseek-v4-flash`
- `opencode-go/deepseek-v4-flash-vision-exp`
- `openrouter/anthropic/claude-sonnet-4`
- `openrouter/apodex/apodex-1.1-mini:free`
- `openrouter/inclusionai/ling-3.0-flash-fin`
- `openrouter/inclusionai/ling-3.0-flash-sante`
- `openrouter/unbiased/pareto`
- `vercel-ai-gateway/inclusionai/ling-3.1-flash-free`

Image:

- `openrouter/inclusionai/ming-image-0.1-design`
- `openrouter/inclusionai/ming-image-0.1-design-layer`

### Retained metadata changes

Prices are USD per million tokens, ordered input / output / cache read / cache write. Only changed fields are listed; each was verified against its captured source. These are not product pricing changes.

| Model | Field | Previous | Current |
| --- | --- | --- | --- |
| `openrouter/deepseek/deepseek-v4-pro` | cost | 0.436044 / 0.872088 / 0.036337 / 0 | 0.434304 / 0.868608 / 0.036192 / 0 |
| `openrouter/deepseek/deepseek-v4.1-flash` | cost | 0.0441 / 0.63 / 0.0054 / 0 | 0.02376 / 0.72 / 0.0054 / 0 |
| `openrouter/google/gemma-4-31b-it` | cost | 0.09 / 0.34 / 0.05 / 0 | 0.2 / 0.4 / 0 / 0 |
| `openrouter/inclusionai/ling-3.0-flash-vl` | cost | 0.021 / 0.0616 / 0.0042 / 0 | 0.06 / 0.18 / 0.012 / 0 |
| `openrouter/inclusionai/ling-3.0-flash-vl` | contextWindow | 262144 | 131072 |
| `openrouter/inclusionai/ling-3.1-flash` | cost | 0 / 0 / 0 / 0 | 0.075 / 0.225 / 0.015 / 0 |
| `openrouter/minimax/minimax-m2` | cost | 0.3 / 1.2 / 0 / 0 | 0.255 / 1.02 / 0 / 0 |
| `openrouter/minimax/minimax-m2` | maxTokens | 176947 | 131072 |
| `openrouter/minimax/minimax-m2.5` | cost | 0.27 / 1.08 / 0.027 / 0 | 0.27 / 0.95 / 0.03 / 0 |
| `openrouter/minimax/minimax-m2.5` | maxTokens | 128000 | 32768 |
| `openrouter/moonshotai/kimi-k3` | cost | 0.73 / 10 / 0.55 / 0 | 0.45 / 15 / 0.28 / 0 |
| `openrouter/openai/gpt-5.6-sol` | cost | 2 / 10 / 0.2 / 2.5 | 4 / 20 / 0.4 / 5 |
| `openrouter/openai/gpt-5.6-sol-pro` | cost | 2 / 10 / 0.2 / 2.5 | 4 / 20 / 0.4 / 5 |
| `openrouter/openai/gpt-5.6-sol-pro:batch` | cost | 1 / 5 / 0.1 / 1.25 | 2 / 10 / 0.2 / 2.5 |
| `openrouter/openai/gpt-5.6-sol:batch` | cost | 1 / 5 / 0.1 / 1.25 | 2 / 10 / 0.2 / 2.5 |
| `openrouter/qwen/qwen3.5-35b-a3b` | cost | 0.08 / 0.75 / 0.04 / 0 | 0.15 / 1 / 0.05 / 0 |
| `openrouter/qwen/qwen3.5-35b-a3b` | maxTokens | 32768 | 16384 |
| `openrouter/qwen/qwen3.5-397b-a17b` | cost | 0.55 / 3.5 / 0.225 / 0 | 0.5 / 3.6 / 0.3 / 0 |
| `openrouter/qwen/qwen3.6-27b` | cost | 0.32 / 3.2 / 0 / 0 | 0.45 / 2.7 / 0 / 0 |
| `openrouter/qwen/qwen3.6-27b` | maxTokens | 81920 | 65536 |
| `openrouter/qwen/qwen3.6-35b-a3b` | cost | 0.1 / 0.95 / 0.1 / 0 | 0.15 / 1 / 0.05 / 0 |
| `openrouter/qwen/qwen3.6-35b-a3b` | maxTokens | 65536 | 235929 |
| `openrouter/qwen/qwen3.8-27b` | cost | 0.04 / 2.3 / 0.0198 / 0 | 0.24 / 2.2 / 0.05 / 0 |
| `openrouter/stepfun/step-5-preview` | contextWindow | 1000000 | 1048576 |
| `openrouter/tencent/hy3` | cost | 0.0825 / 0.33 / 0.020625 / 0 | 0.132 / 0.528 / 0.033 / 0 |
| `openrouter/tencent/hy4-preview` | cost | 0.7506 / 2.2509 / 0.0378 / 0 | 0.834 / 2.501 / 0.042 / 0 |
| `openrouter/z-ai/glm-5` | maxTokens | 128000 | 131072 |
| `openrouter/z-ai/glm-5.3` | cost | 0.079 / 4.8 / 0.059 / 0 | 0.12 / 4.8 / 0.119 / 0 |
| `openrouter/z-ai/glm-5.3-flash` | cost | 0.0261 / 0.9 / 0.0108 / 0 | 0.15 / 0.5 / 0.03 / 0 |
| `openrouter/z-ai/glm-5.3-flash` | maxTokens | 943718 | 943717 |
| `openrouter/~deepseek/deepseek-flash-latest` | cost | 0.0441 / 0.63 / 0.0054 / 0 | 0.02376 / 0.72 / 0.0054 / 0 |
| `openrouter/~deepseek/deepseek-pro-latest` | cost | 0.24948 / 0.74844 / 0.007938 / 0 | 0.1307 / 8 / 0.13 / 0 |
| `openrouter/~google/gemini-pro-latest` | cost | 2 / 12 / 0.2 / 0.375 | 2 / 10 / 0.1 / 0.1875 |
| `openrouter/~moonshotai/kimi-latest` | cost | 0.73 / 10 / 0.55 / 0 | 0.29 / 24 / 0.28 / 0 |
| `openrouter/~z-ai/glm-flash-latest` | cost | 0.0261 / 0.9 / 0.0108 / 0 | 0.036 / 0.9 / 0.01125 / 0 |
| `openrouter/~z-ai/glm-latest` | cost | 0.055 / 5 / 0.06 / 0 | 0.0608 / 4.4 / 0.0565 / 0 |
| `openrouter/~z-ai/glm-latest` | maxTokens | 943718 | 131072 |
| `vercel-ai-gateway/inclusionai/ling-3.1-flash` | cost | 0 / 0 / 0 / 0 | 0.3 / 0.9 / 0.06 / 0 |
| `vercel-ai-gateway/xiaomi/mimo-v2.5-pro` | cost | 0.435 / 0.87 / 0.0036 / 0 | 0.3045 / 0.609 / 0.0028 / 0 |
| `openrouter/black-forest-labs/flux-3-image` | name | Black Forest Labs: FLUX.3 Image | Black Forest Labs: FLUX 3 Image |

