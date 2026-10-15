# Linc 0.79.30 release verification

Tracked in [CD-1861](https://linear.app/casemarkai/issue/CD-1861/prepare-linc-07930-release-with-patched-brace-expansion). Base: merged main `96c179aab6ea46e495abb6ac378839b0d8e4da4d`.
Only `@casemark/linc` changes version. Bundled pi workspaces and dependency ranges remain at 0.79.10.

## Owner-authorized changelog audit — 2026-10-15

The owner authorized the equivalent `/cl` audit after #99 merged. Every commit since published v0.79.29 was inspected: the prior release merge adds no implementation delta; CD-1849 pins brace-expansion 5.0.12 under minimatch 10.2.5, regenerates the lock/shrinkwrap, and adds a bounded release regression. Its follow-up preserves only SystemRoot/SystemDrive for the Windows child, without inheriting credentials or NODE_OPTIONS. No new agent, AI or TUI implementation requires another cross-package entry. Existing released changelog sections are unchanged. This maintenance release has no new skill features.

The 5.0.12 pin replaces the vulnerable 5.0.6 runtime resolution. The development-only 2.x dependency is unchanged, not forced across a major-version boundary. No new dependency lifecycle-script allowance, provider default, skill trust rule or production configuration is introduced.

## Validation status

Release verification is in progress. This document and the PR will distinguish completed local/CI checks from outstanding live smoke checks before review readiness is declared.

No publication, publishing-tag push, runtime image/deployment, global snapshot pointer update or org enrollment is authorized by this preparation. Casemark remains the only enabled org; the currently deployed package is not remediated by this PR alone.

## Catalog review

Relative to published v0.79.29: chat 1,504 → 1,509 (eight added, three removed, 15 retained entries changed); image 57 → 58 (one added, no removals or retained-entry changes). All retained changes are OpenRouter price metadata except one output limit. No retained entry changes API, endpoint, input modalities or reasoning support. Every addition, removal and changed retained field was checked against captured sources and existing generator rules. All emitted prices are finite and nonnegative. Generated catalogs were not hand-edited.

Source membership, price metadata and advertised limits do not certify authenticated provider behavior. Zero image token prices preserve the existing source/default interpretation and do not certify that image generation is free. Provider defaults and custom-model fallback are unchanged.

### Captured sources

| Source | Captured UTC | SHA-256 |
| --- | --- | --- |
| [models.dev](https://models.dev/api.json) | 2026-10-15T20:33:42.761Z | `13af221a6c60abc2867f85804388f328001b6979e47a536b0873b8df9b38f450` |
| [NVIDIA NIM](https://integrate.api.nvidia.com/v1/models) | 2026-10-15T20:33:42.909Z | `2da68136cacea2610cf95ac3e0df76a361764febef9edb23011ef3bd676a483c` |
| [OpenRouter chat](https://openrouter.ai/api/v1/models) | 2026-10-15T20:33:43.074Z | `b3984d6c029c5e58ba7dad336b7fb283d81914f03198b97391fa03f8e3c6ceb8` |
| [Vercel AI Gateway](https://ai-gateway.vercel.sh/v1/models) | 2026-10-15T20:33:43.236Z | `c015c548bdca0f2d2c5b675b3f9e261f55c22efd20fcf78cfbec9740cc59f414` |
| [OpenRouter image](https://openrouter.ai/api/v1/models?output_modalities=image) | 2026-10-15T20:33:43.580Z | `9e2b14acbf6fcf5399e23b393acbab22539a81722bf0fa3c278b4ddfb6aa4807` |

### Additions

Chat:

- `opencode/nemotron-3.5-super-vl-free`
- `openrouter/meta/muse-spark-open`
- `openrouter/nvidia/nemotron-3.5-super-vl`
- `openrouter/nvidia/nemotron-3.5-super-vl:free`
- `vercel-ai-gateway/meta/muse-spark-open`
- `vercel-ai-gateway/nvidia/nemotron-3.5-super-vl`
- `vercel-ai-gateway/stealth/cat-jam`
- `vercel-ai-gateway/stepfun/step-5-preview`

Image:

- `openrouter/black-forest-labs/flux-3-image-klein`

### Removals

- `opencode-go/grok-4.6`: absent from captured models.dev source.
- `opencode-go/minimax-m2.7`: marked deprecated in captured models.dev source.
- `openrouter/unbiased/pareto-26.10-preview`: absent from captured OpenRouter source.

Existing selections of these IDs should switch to a currently listed model. Catalog exclusion is not proof the upstream endpoint has been retired. Explicit/custom-model fallback and saved/resume behavior are unchanged. There are no image removals.

### Retained metadata changes

Prices are USD per million tokens, ordered input / output / cache read / cache write. These source metadata updates do not change Case.dev product pricing.

| OpenRouter model | Field | Previous | Current |
| --- | --- | --- | --- |
| `deepseek/deepseek-v4-flash-0731` | cost | 0.016 / 0.64 / 0.016 / 0 | 0.0137 / 0.64 / 0.0137 / 0 |
| `deepseek/deepseek-v4-pro` | cost | 0.434304 / 0.868608 / 0.036192 / 0 | 0.376884 / 0.753768 / 0.031407 / 0 |
| `deepseek/deepseek-v4.1-flash` | cost | 0.02376 / 0.72 / 0.0054 / 0 | 0.01116 / 0.72 / 0.0054 / 0 |
| `google/gemini-3.8-flash` | cost | 0.75 / 3.75 / 0.075 / 0.04166667 | 0.825 / 4.125 / 0.0825 / 0.04166667 |
| `google/gemma-4-26b-a4b-it` | cost | 0.09 / 0.3 / 0.05 / 0 | 0.0765 / 0.255 / 0.0425 / 0 |
| `moonshotai/kimi-k3` | cost | 0.45 / 15 / 0.28 / 0 | 0.405 / 15 / 0.28 / 0 |
| `qwen/qwen3.6-27b` | cost | 0.45 / 2.7 / 0 / 0 | 0.25 / 2 / 0.025 / 0 |
| `tencent/hy3` | cost | 0.132 / 0.528 / 0.033 / 0 | 0.0825 / 0.33 / 0.020625 / 0 |
| `tencent/hy4-preview` | cost | 0.834 / 2.501 / 0.042 / 0 | 0.7506 / 2.2509 / 0.0378 / 0 |
| `z-ai/glm-5.2` | cost | 0.06 / 7 / 0.059 / 0 | 0.1 / 7 / 0.099 / 0 |
| `z-ai/glm-5.3` | cost | 0.12 / 4.8 / 0.119 / 0 | 0.11 / 6 / 0.109 / 0 |
| `~deepseek/deepseek-flash-latest` | cost | 0.02376 / 0.72 / 0.0054 / 0 | 0.01116 / 0.72 / 0.0054 / 0 |
| `~deepseek/deepseek-v4-flash-latest` | cost | 0.0144 / 0.576 / 0.0108 / 0 | 0.01233 / 0.576 / 0.0108 / 0 |
| `~moonshotai/kimi-latest` | cost | 0.29 / 24 / 0.28 / 0 | 0.35 / 14 / 0.3 / 0 |
| `~z-ai/glm-flash-latest` | cost | 0.036 / 0.9 / 0.01125 / 0 | 0.0356 / 0.5528 / 0.0125 / 0 |
| `~z-ai/glm-flash-latest` | maxTokens | 943718 | 131072 |
