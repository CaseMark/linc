# Linc 0.79.20 verification

Verified September 17, 2026 for [release PR #72](https://github.com/CaseMark/linc/pull/72).
The runtime artifact was built from release commit `47bea3a14`; the review
follow-up changes only documentation and changelog text.

## Authenticated release smoke

The packed Node install and compiled macOS ARM64 Bun binary ran outside the
repository against `https://preview.api.case.dev`. Both used an existing test
identity, isolated agent directories, and the Case.dev default model
`casemark/core-large`. No model override or substitute provider was used.

| Artifact | Print mode | Interactive terminal |
| --- | --- | --- |
| Installed npm tarball, Node 22.23.1 | `LINC_SMOKE_OK` | `LINC_INTERACTIVE_OK` |
| Compiled Bun binary, macOS ARM64 | `LINC_SMOKE_OK` | `LINC_INTERACTIVE_OK` |

Interactive checks used controlled PTYs: launch the TUI, submit the prompt,
observe the completed assistant response and usage footer, then exit cleanly.
These were real authenticated completions, not startup-only checks. The
credential was loaded into the smoke child process environment and is not
included in this evidence. The existing smoke identity was reused; no test
user or organization was created.

Version, help, and model listing passed for both artifacts. The isolated npm
install also passed five parser cases: vision tag only, multimodal tag only,
null modalities, explicit text despite a vision tag, and explicit image input.
Installed JS has no image-granting tag fallback. Bundled pi-agent-core contains
CaseMark's `shouldStopAfterTurn` hook; all three pi packages are present at
0.79.10 with the 99-package runtime dependency closure.

## Catalog regeneration

`packages/ai/scripts/generate-models.ts` is unchanged in this release. A fresh
`npm --prefix packages/ai run generate-models` reproduced the committed catalog
byte-for-byte. SHA-256 before and after:

```text
db36d46e0df05834f9dea9e6fda44cad7e51920c503c40e49a391af13c1fdd30
```

All six changed existing OpenRouter records were compared with the live
[OpenRouter model API](https://openrouter.ai/api/v1/models) at
2026-09-17 22:46 UTC. Every cost field and output limit matched. The generator
converts source prices per token to USD per million tokens and copies
`top_provider.max_completion_tokens`.

| OpenRouter model ID | Input / output / cache-read USD per million | Maximum output tokens |
| --- | --- | --- |
| `deepseek/deepseek-chat` | 0.32 / 0.89 / 0 | 16,384 |
| `deepseek/deepseek-v4-flash` | 0.07 / 0.14 / 0.014 | 384,000 |
| `meta/muse-glimmer-30b` | 0.30 / 1.10 / 0.04 | 117,964 |
| `nvidia/nemotron-3-nano-30b-a3b` | 0.06 / 0.24 / 0 | 235,929 |
| `nvidia/nemotron-3-ultra-550b-a55b` | 0.625 / 3.125 / 0.1875 | 32,768 |
| `~deepseek/deepseek-flash-latest` | 0.135 / 0.54 / 0.00405 | 943,718 |

Cache-write pricing is zero for these records. The review's 943,718-token
example refers to **DeepSeek Flash Latest**, not DeepSeek Pro. These values
describe OpenRouter's current routing metadata, not independently measured
limits for every underlying provider.

## Fireworks removal

The generated Fireworks catalog no longer includes
`accounts/fireworks/models/mistral-large-3-fp8` because the source feed no longer
contains it. [models.dev #7286](https://github.com/anomalyco/models.dev/pull/7286),
merged in commit `6092333750ba7d422ad45e52ed1ad0c3e8451fa8`, explicitly removed
this model from its serverless catalog because it is on-demand only.

The [Fireworks model page](https://fireworks.ai/models/fireworks/mistral-large-3-fp8)
confirms on-demand deployment is available and serverless access is unsupported.
This is a catalog correction, not a Linc parser regression or a claim that the
model is retired from Fireworks. The removal and selection impact are called
out in the 0.79.20 changelog.

## Versioning and remaining rollout

Only `@casemark/linc` is published by CaseMark. The pi workspaces deliberately
remain at 0.79.10 and are bundled from this repository. See the corrected
[release process](release.md); upstream lockstep release commands must not be
used for this fork.

The original PR CI passed. Follow-up documentation changes rerun PR CI.
Theodore still merges with a merge commit and pushes the publishing tag.
The sandbox pin PR must wait for npm publication; preview snapshot validation
must then pass before production promotion.
