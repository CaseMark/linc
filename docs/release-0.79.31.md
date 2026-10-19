# Linc 0.79.31 release verification

Tracked in [CD-1830](https://linear.app/casemarkai/issue/CD-1830). Base: staging `43c2ba73c98b8399a9b597182fe225a4104c6a4e`, including merged [#101](https://github.com/CaseMark/linc/pull/101).
Only `@casemark/linc` changes version; all three bundled pi workspaces and their dependency ranges remain at 0.79.10.

## Owner-authorized changelog audit — 2026-10-19

The owner authorized the equivalent of `/cl` on current staging. All five commits and eight changed files since published v0.79.30 were audited; the prior release merge adds no implementation delta. The implementation adds verified binary MCP companion resources and bounded native PDF tables. Its follow-up caps MIME metadata, documents asset retention and enables ordinary build/check/test CI for staging. One mocked OpenRouter reasoning test now uses a typed fixture instead of a retired live-catalog ID; its wire assertions are unchanged. There is no other agent/TUI runtime delta requiring a changelog entry. Older AI/agent Unreleased entries already included in previous Linc bundles are not new features of this release. Released changelog sections are unchanged.

This preparation follows the owner's staging-first policy: release metadata merges into staging, then the entire staging branch is promoted to main. It overrides the older main-first preparation instructions in docs/release.md; no focused production promotion is intended.

## Compatibility and security boundaries

- Binary companions must belong to the held manifest, use canonical base64 and match decoded size/SHA-256. SKILL.md remains text-only. Each blob is at most 3 MiB, MIME metadata at most 256 UTF-8 bytes, with existing response/manifest bounds retained.
- Assets are new exclusive mode-0600 files in host-named workspace directories, outside trusted skill directories. Cancellation or concurrent registry failure removes that read's newly created directory. Successful assets remain until workspace-owner cleanup or ephemeral teardown; no background retention policy is introduced. Reading data is not execution approval, sanitization or permission to run remote code.
- PDF tables contain literal strings only, up to 100 rows and 12 columns per table, within existing aggregate document limits. The formatter must advertise the exact `pdf-tables-v1` token in `X-Case-Document-Features`; older formatters fail before a table PDF is persisted. Text-only PDF requests retain compatibility. Ship the server counterpart first; the owner reports Case.dev production is released.
- Standard-font PDF Unicode limitations remain explicit. Arbitrary scripts, advanced templates, images, macros and persistent-workspace reuse are not made compatible by this release. Existing remote-code approval remains in force.

## Validation

- Node 22.22.2 ignore-scripts install, full build and full code check pass. Lock/shrinkwrap diffs contain only Linc version fields, with no dependency or lifecycle-script allowance changes.
- Credential-stripped `./test.sh` passes: 2,906 tests passed, 825 existing credential/platform-dependent tests skipped; no test filters, timeouts or assertions changed. Auth was restored byte-for-byte, with no backup left behind.
- Publish dry-run passes. The actual tarball installs into an empty external directory with Linc 0.79.31 and all three CaseMark pi builds at 0.79.10. Installed MCP client/extension and PDF-tool JavaScript hashes match the build. Installed-code probes pass decoded-byte integrity, tamper/other-tenant URI rejection, workspace mode-0600 writes, unchanged execution blocking, literal table encoding, older-server rejection before persistence and no-overwrite checks. The installed production dependency audit reports zero vulnerabilities; pre-existing development-install advisories remain outside this version-only metadata change.
- The repository script builds a macOS ARM64 Bun 1.3.4 archive. Node and Bun pass version/help, model listing and authenticated print completions using `casemark-core` / `casemark/core-potassium`, ending with `stopReason: stop`. Node also completes a real PTY interactive turn and exits 0. Bun's interactive completion is not yet verified; keep this release draft until it passes or the owner explicitly accepts that risk. No persisted credential or new login was needed; account/provider metadata was checked with an in-memory synthetic store, separately from real authenticated completions.
- Replaying all five captured feeds reproduces both generated catalogs byte-for-byte after formatting. GitHub CI is reported separately for the exact PR head; local checks do not certify publishing or deployed images. These are local macOS candidate checks, not certification of all platform archives.

No publication, publishing-tag push, deployment, image bake/activation or org-enrollment change is authorized by this preparation. Casemark remains the only enabled org; P3 remains on its existing path.

## Catalog review

Chat 1509 → 1526: 27 added, 10 removed, 32 retained entries changed. Image 58 → 61: 3 added, no removals or retained changes. Every changed retained field is price or limit metadata; API, endpoint, input modalities and reasoning support are unchanged for retained entries. Additions, removals and changed prices/limits were checked against captured sources and existing generator rules. All emitted prices are finite and nonnegative. Generated catalogs were not hand-edited.

Source membership does not certify authenticated provider behavior. Zero/missing image prices preserve existing generator interpretation, not a promise that generation is free. Provider defaults and custom-model fallback are unchanged. Reduced output/context caps below may require existing callers to lower requests; this release does not introduce new clamping or guarantee handling of over-limit requests.

### Captured sources

| Source | Captured UTC | SHA-256 |
| --- | --- | --- |
| [https://models.dev/api.json](https://models.dev/api.json) | 2026-10-19T20:56:15.436Z | `3759647be3fd5d98270b03b5e834bc984ed06e897d55b504b5cd07b5685e6af0` |
| [https://integrate.api.nvidia.com/v1/models](https://integrate.api.nvidia.com/v1/models) | 2026-10-19T20:56:15.619Z | `2da68136cacea2610cf95ac3e0df76a361764febef9edb23011ef3bd676a483c` |
| [https://openrouter.ai/api/v1/models](https://openrouter.ai/api/v1/models) | 2026-10-19T20:56:15.797Z | `f330e4ddbd89f4404c1f66a7ea2f211f295e9e2829584d3c9a979d8f25428460` |
| [https://ai-gateway.vercel.sh/v1/models](https://ai-gateway.vercel.sh/v1/models) | 2026-10-19T20:56:16.026Z | `5c5fe9d81d7ed7f840cd88a94b0b3efe3bf33022cccab57d2eb7119bc79110c5` |
| [https://openrouter.ai/api/v1/models?output_modalities=image](https://openrouter.ai/api/v1/models?output_modalities=image) | 2026-10-19T20:56:16.473Z | `eb8f1113fb636cde9e22853f6975a276c141963769901d28072d327a66a8a765` |

### Additions

Chat:

- `fireworks/accounts/fireworks/models/deepseek-v4p1-flash-1017`
- `fireworks/accounts/fireworks/models/muse-spark-open`
- `huggingface/deepseek-ai/DeepSeek-V4.1-Flash-1017`
- `nvidia/stepfun-ai/step-5-preview`
- `opencode/beam-free`
- `opencode/glm-5.3-flash-free`
- `opencode/minimax-m3.1-flash-free`
- `opencode-go/beam-free`
- `opencode-go/minimax-m3.1-flash-free`
- `opencode-go/step-5-preview`
- `openrouter/deepseek/deepseek-v4.1-flash-1017`
- `openrouter/elorian/glimpse`
- `openrouter/inception/mercury-3`
- `openrouter/minimax/minimax-m3.1-flash:free`
- `openrouter/qwen/qwen3.7-plus:batch`
- `openrouter/reflection/beam-1.0-501b-a23b`
- `openrouter/unbiased/pareto-26.10`
- `openrouter/xingchen-agi/xing4.0-29b-a4b:free`
- `together/meta-models/Muse-Spark-Open-816B-A42B`
- `together/nvidia/NVIDIA-Nemotron-3.5-Super-VL`
- `together/reflection/Beam-1.0-501B-A23B`
- `vercel-ai-gateway/deepseek/deepseek-v4.1-flash-1017`
- `vercel-ai-gateway/deepseek/deepseek-v4.1-flash-1017-fast`
- `vercel-ai-gateway/inception/mercury-3`
- `vercel-ai-gateway/minimax/minimax-m3.1-flash`
- `vercel-ai-gateway/reflection/beam`
- `vercel-ai-gateway/reflection/beam-free`

Image:

- `openrouter/krea/k3-edit`
- `openrouter/qwen/qwen-image-2.1-pro`
- `openrouter/qwen/qwen-image-2.1-turbo`

### Catalog removals

- `opencode/cat-jam-free`: deprecated in captured source.
- `opencode/muse-spark-1.3-contributor-free`: deprecated in captured source.
- `opencode/space-bunny-free`: deprecated in captured source.
- `opencode/step-5-preview-free`: deprecated in captured source.
- `opencode-go/cat-jam-free`: deprecated in captured source.
- `opencode-go/space-bunny`: deprecated in captured source.
- `opencode-go/step-5-preview-free`: deprecated in captured source.
- `openrouter/deepseek/deepseek-r1`: absent from captured source.
- `vercel-ai-gateway/anthropic/claude-sonnet-4`: absent from captured source.
- `vercel-ai-gateway/stealth/cat-jam`: absent from captured source.

### Retained metadata changes

Prices are USD per million tokens, ordered input / output / cache read / cache write. They do not change Case.dev product pricing.

| Model | Field | Previous | Current |
| --- | --- | --- | --- |
| `openrouter/deepseek/deepseek-v3.2` | cost | 0.259 / 0.8 / 0.14 / 0 | 0.28 / 0.42 / 0.028 / 0 |
| `openrouter/deepseek/deepseek-v3.2` | maxTokens | 147456 | 65536 |
| `openrouter/deepseek/deepseek-v4-flash-0731` | cost | 0.0137 / 0.64 / 0.0137 / 0 | 0.1298 / 0.3894 / 0.00413 / 0 |
| `openrouter/deepseek/deepseek-v4-flash-0731` | maxTokens | 943718 | 131072 |
| `openrouter/deepseek/deepseek-v4-pro-0813` | maxTokens | 393216 | 384000 |
| `openrouter/deepseek/deepseek-v4.1-flash` | cost | 0.01116 / 0.72 / 0.0054 / 0 | 0.028 / 0.08 / 0.0016 / 0 |
| `openrouter/deepseek/deepseek-v4.1-flash:batch` | cost | 0.112 / 0.336 / 0.00336 / 0 | 0.05 / 0.15 / 0.004 / 0 |
| `openrouter/deepseek/deepseek-v4.1-flash:batch` | maxTokens | 131072 | 384000 |
| `openrouter/google/gemini-4-argon` | maxTokens | 65536 | 943718 |
| `openrouter/google/gemma-3-27b-it` | cost | 0.08 / 0.45 / 0.04 / 0 | 0.08 / 0.35 / 0.04 / 0 |
| `openrouter/meta-llama/llama-3.3-70b-instruct` | cost | 0.59 / 0.79 / 0.295 / 0 | 0.1 / 0.32 / 0 / 0 |
| `openrouter/meta-llama/llama-3.3-70b-instruct` | maxTokens | 32768 | 16384 |
| `openrouter/meta-llama/llama-4-maverick` | contextWindow | 1048576 | 524288 |
| `openrouter/meta-llama/llama-4-scout` | cost | 0.18 / 0.59 / 0 / 0 | 0.1 / 0.3 / 0 / 0 |
| `openrouter/meta-llama/llama-4-scout` | maxTokens | 117964 | 16384 |
| `openrouter/moonshotai/kimi-k3` | cost | 0.405 / 15 / 0.28 / 0 | 0.239 / 11.936 / 0.21 / 0 |
| `openrouter/nvidia/nemotron-3.5-super-vl` | cost | 0.15 / 0.5 / 0.02 / 0 | 0.1 / 0.4 / 0.08 / 0 |
| `openrouter/qwen/qwen3-30b-a3b-instruct-2507` | cost | 0.1 / 0.3 / 0 / 0 | 0.09 / 0.3 / 0 / 0 |
| `openrouter/qwen/qwen3-next-80b-a3b-instruct` | cost | 0.1 / 1.1 / 0.07 / 0 | 0.09 / 1.1 / 0 / 0 |
| `openrouter/qwen/qwen3-next-80b-a3b-instruct` | maxTokens | 235929 | 16384 |
| `openrouter/qwen/qwen3.5-27b` | cost | 0.26 / 2.6 / 0 / 0 | 0.27 / 2.16 / 0.27 / 0 |
| `openrouter/qwen/qwen3.5-27b` | maxTokens | 81920 | 65536 |
| `openrouter/qwen/qwen3.5-35b-a3b` | maxTokens | 16384 | 235929 |
| `openrouter/stepfun/step-5-preview` | cost | 1 / 2.7 / 0.05 / 0 | 1 / 2.7 / 0.1 / 0 |
| `openrouter/z-ai/glm-4.6` | cost | 0.5 / 2 / 0.1 / 0 | 0.55 / 2.2 / 0.11 / 0 |
| `openrouter/z-ai/glm-4.7` | cost | 0.6 / 2.2 / 0.11 / 0 | 0.54 / 1.98 / 0.099 / 0 |
| `openrouter/z-ai/glm-5.2` | cost | 0.1 / 7 / 0.099 / 0 | 0.62 / 2.42 / 0.14 / 0 |
| `openrouter/z-ai/glm-5.3` | cost | 0.11 / 6 / 0.109 / 0 | 0.079 / 1.4 / 0.078 / 0 |
| `openrouter/z-ai/glm-5.3-flash` | cost | 0.15 / 0.5 / 0.03 / 0 | 0.048 / 0.16 / 0.006 / 0 |
| `openrouter/z-ai/glm-5.3-flash` | maxTokens | 943717 | 943718 |
| `openrouter/z-ai/glm-5.3-flash:batch` | cost | 0.06 / 0.2 / 0.012 / 0 | 0.05 / 0.18 / 0.01 / 0 |
| `openrouter/~deepseek/deepseek-flash-latest` | cost | 0.01116 / 0.72 / 0.0054 / 0 | 0.035 / 0.6 / 0.004 / 0 |
| `openrouter/~deepseek/deepseek-v4-flash-latest` | cost | 0.01233 / 0.576 / 0.0108 / 0 | 0.0151 / 0.45 / 0.0151 / 0 |
| `openrouter/~google/gemini-pro-latest` | maxTokens | 65536 | 943718 |
| `openrouter/~moonshotai/kimi-latest` | cost | 0.35 / 14 / 0.3 / 0 | 0.238 / 16 / 0.228 / 0 |
| `openrouter/~unbiased/pareto-latest` | cost | 2.5 / 7.5 / 0.25 / 0 | 0.8 / 3.2 / 0.03 / 0 |
| `openrouter/~unbiased/pareto-latest` | contextWindow | 262144 | 1048576 |
| `openrouter/~z-ai/glm-flash-latest` | cost | 0.0356 / 0.5528 / 0.0125 / 0 | 0.048 / 0.16 / 0.006 / 0 |
| `openrouter/~z-ai/glm-flash-latest` | maxTokens | 131072 | 943718 |
| `openrouter/~z-ai/glm-latest` | cost | 0.0608 / 4.4 / 0.0565 / 0 | 0.053 / 6 / 0.033 / 0 |
| `openrouter/~z-ai/glm-latest` | maxTokens | 131072 | 943718 |
| `vercel-ai-gateway/deepseek/deepseek-v4.1-flash` | cost | 0.3 / 1.2 / 0.007 / 0 | 0.075 / 0.3 / 0.0015 / 0 |
| `vercel-ai-gateway/deepseek/deepseek-v4.1-flash` | maxTokens | 32768 | 1048576 |
| `vercel-ai-gateway/stepfun/step-5-preview` | cost | 1 / 2.7 / 0.05 / 0 | 1 / 2.7 / 0.1 / 0 |

