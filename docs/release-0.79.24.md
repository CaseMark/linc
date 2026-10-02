# Linc 0.79.24 release candidate verification

Tracked in [CD-1716](https://linear.app/casemarkai/issue/CD-1716).
Base: merged main `5a4804d51a9f57749bad14def0c894c12377ca00`, including [dependency patch #86](https://github.com/CaseMark/linc/pull/86).
Only Linc is versioned to 0.79.24; bundled pi packages/ranges remain 0.79.10.
This is unpublished candidate evidence, not production or ESQ-C3 live acceptance.

## Verification — 2026-10-02

- Clean `npm ci --ignore-scripts`; full build with captured live catalog feeds;
  `npm run check`; full non-live `./test.sh`: **2,738 passed, 821 skipped**.
  Skips are not live-provider coverage. Packaging runs separately from CLI
  tests so bundle cleanup cannot race with their imports.
- Lockfile and shrinkwrap differ from merged main only in Linc version fields.
  The reviewed protobufjs 7.6.5 / ws 8.21.0 closure is preserved.
- Publication dry run passes; 0.79.24 was not published when queried.
- Fresh tarball installed outside the repo with `--omit=dev --ignore-scripts`:
  installed runtime `npm audit --omit=dev` reports **zero vulnerabilities**.
  Installed protobufjs 7.6.5, ws 8.21.0, Linc 0.79.24 and bundled pi 0.79.10
  versions are asserted. Root development/example advisories are not covered
  by this installed-runtime audit and have not been silently upgraded.
- Installed document-tool and MCP-extension JS bytes equal their workspace
  builds. Native DOCX output passes ZIP CRC and XML parsing, escaped hostile
  literal text, fixed five parts, four table cells, and absence of external
  relationships, field codes, DTDs or entities. Exclusive creation, mode 0600,
  traversal/extra input/invalid XML/ragged-table rejection pass.
- A synthetic saved unapproved manifest blocks Bash before and after native
  document creation and after policy rebind. This is installed component
  evidence, not actual persistent sandbox acceptance.
- Installed Node CLI and compiled macOS ARM64 Bun binary pass 0.79.24 version,
  help, model listing, read-only provider/account selection, authenticated
  print replies and actual interactive replies. Interactive sessions selected
  OpenAI `gpt-5.4` automatically with no provider/model flags, using the inherited
  environment key. Startup was offline, tools and thinking disabled. Print
  tests selected the same model explicitly. Neither test certifies Case.dev's
  gateway/default model or live ESQ-C3 behavior. No key was printed, copied to
  files, or supplied in command arguments; no authentication was changed.
- Installed protobuf encode/decode round-trip passes. No prior 0.79.24 tarball
  or binary is reused. Temporary proof artifacts are not published releases.

## Catalog review

Compared exported objects against `v0.79.23`, not changed-line counts:

| Catalog | Before | Candidate | Added | Removed | Retained metadata changes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chat | 1,354 | 1,433 | 116 | 37 | 309 |
| Image | 54 | 59 | 5 | 0 | 3 |

Metadata counts include precision-only changes, not just price changes.
Against merged main, regeneration adds three chat entries, removes three,
changes 21 retained chat entries, and adds two image entries. No generator
implementation changes are part of this release PR.

Fresh chat additions: `nvidia/deepseek-ai/deepseek-v4.1-flash`, `nvidia/google/diffusiongemma-26b-a4b-it`, `opencode/fledge-alpha-free`.
NVIDIA IDs exist in both models.dev and NVIDIA's model list; all three
additions are marked tool-capable by the captured models.dev feed.
Fresh image additions: `openrouter/black-forest-labs/flux-3-image` and
`openrouter/bytedance-seed/seedream-5-0-flash`, present in OpenRouter's image
feed. Zero token-price fields are not a promise of free image generation.

All 21 retained chat changes match captured source prices and limits:
Fireworks uses models.dev USD/million prices; OpenRouter prices are converted
from USD/token and rounded to eight decimals. Context/output limits also
match the source values. Other fields of these retained entries are unchanged.

| Provider/model | New input / output / cache-read USD per million | Output limit before → after |
| --- | --- | --- |
| `fireworks/accounts/fireworks/models/deepseek-v4p1-flash` | 0.3 / 1.2 / 0.006 | 384000 → 384000 |
| `fireworks/accounts/fireworks/routers/deepseek-flash-latest` | 0.3 / 1.2 / 0.006 | 384000 → 384000 |
| `openrouter/deepseek/deepseek-chat-v3-0324` | 0.29 / 1.14 / 0.11 | 147456 → 115200 |
| `openrouter/deepseek/deepseek-v4-flash` | 0.042 / 0.084 / 0.0084 | 131072 → 384000 |
| `openrouter/deepseek/deepseek-v4-flash-0731` | 0.0077 / 1.28 / 0.0077 | 943718 → 943718 |
| `openrouter/deepseek/deepseek-v4.1-flash` | 0.3 / 1.2 / 0.006 | 943718 → 943718 |
| `openrouter/moonshotai/kimi-k2-thinking` | 0.6 / 2.5 / 0.15 | 235929 → 98304 |
| `openrouter/moonshotai/kimi-k3` | 2.7 / 13.5 / 0.27 | 943718 → 943718 |
| `openrouter/nvidia/nemotron-3-ultra-550b-a55b` | 0.5 / 2.2 / 0.1 | 182520 → 16384 |
| `openrouter/nvidia/nemotron-3.5-lightning` | 0.06 / 0.16 / 0.03 | 131072 → 32768 |
| `openrouter/qwen/qwen3.5-35b-a3b` | 0.15 / 1 / 0.05 | 65536 → 235929 |
| `openrouter/tencent/hy3` | 0.132 / 0.528 / 0.033 | 128000 → 128000 |
| `openrouter/tencent/hy4-preview` | 0.834 / 2.501 / 0.042 | 64000 → 64000 |
| `openrouter/thinkingmachines/inkling` | 0.95 / 4.05 / 0.16 | 471859 → 262144 |
| `openrouter/z-ai/glm-5.3` | 1.4 / 4.4 / 0.14 | 943718 → 131072 |
| `openrouter/~deepseek/deepseek-flash-latest` | 0.015 / 1.2 / 0.002115 | 943718 → 943718 |
| `openrouter/~deepseek/deepseek-pro-latest` | 0.132 / 0.396 / 0.0042 | 393216 → 393216 |
| `openrouter/~deepseek/deepseek-v4-flash-latest` | 0.0077 / 1.28 / 0.0077 | 943718 → 943718 |
| `openrouter/~moonshotai/kimi-latest` | 1.39 / 13 / 0.8 | 943718 → 943718 |
| `openrouter/~z-ai/glm-flash-latest` | 0.02625 / 0.9 / 0.01125 | 943718 → 943718 |
| `openrouter/~z-ai/glm-latest` | 0.12 / 4 / 0.08 | 235929 → 131072 |

### Catalog removals

All removed IDs relative to 0.79.23 follow. The three newly removed Together
IDs (`DeepSeek-V4-Pro`, `gemma-4-31B-it`, `gpt-oss-20b`) are absent from the
captured source feed. Explicit saved selections are not rewritten; choose a
listed model with `linc --list-models`. The versioned DeepSeek 0813 snapshot
and GPT-OSS 120B remain available in the generated catalog.

- `fireworks/accounts/fireworks/models/deepseek-v4-flash-0731`
- `fireworks/accounts/fireworks/models/deepseek-v4-flash-vision-exp`
- `fireworks/accounts/fireworks/models/deepseek-v4-pro`
- `fireworks/accounts/fireworks/models/deepseek-v4-pro-0813`
- `fireworks/accounts/fireworks/models/glm-5p2`
- `fireworks/accounts/fireworks/models/kimi-k2p6`
- `fireworks/accounts/fireworks/models/kimi-k2p7-code`
- `fireworks/accounts/fireworks/models/minimax-m2p7`
- `fireworks/accounts/fireworks/models/muse-glimmer-30b`
- `fireworks/accounts/fireworks/models/qwen3p7-plus`
- `fireworks/accounts/fireworks/routers/deepseek-pro-latest`
- `fireworks/accounts/fireworks/routers/glm-5p2-fast`
- `mistral/magistral-small`
- `opencode/mimo-v2.5-free`
- `opencode/muse-spark-1.2-contributor-free`
- `opencode-go/glm-5.1`
- `opencode-go/kimi-k2.6`
- `opencode-go/qwen3.6-plus`
- `opencode-go/qwen3.7-max`
- `openrouter/anthropic/claude-3-haiku`
- `openrouter/deepseek/deepseek-v4-flash-0731:batch`
- `openrouter/deepseek/deepseek-v4-flash-vision-exp:batch`
- `openrouter/deepseek/deepseek-v4-pro-0813:batch`
- `openrouter/inclusionai/ling-3.0-flash-fin:free`
- `openrouter/inclusionai/ling-3.0-flash-vl:free`
- `openrouter/kwaipilot/kat-coder-pro-v2`
- `openrouter/meta/muse-glimmer-30b:batch`
- `openrouter/nex-agi/nex-n2.5-mini:free`
- `openrouter/nex-agi/nex-n2.5-pro:free`
- `openrouter/z-ai/glm-5.2:batch`
- `together/deepseek-ai/DeepSeek-V4-Pro`
- `together/google/gemma-4-31B-it`
- `together/moonshotai/Kimi-K2.6`
- `together/moonshotai/Kimi-K2.7-Code`
- `together/openai/gpt-oss-20b`
- `vercel-ai-gateway/inclusionai/ling-3.0-flash-fin-free`
- `vercel-ai-gateway/inclusionai/ling-3.0-flash-vl-free`

### Captured public sources

- [https://models.dev/api.json](https://models.dev/api.json), 2026-10-02T14:01:17.591Z; SHA-256 `9753986d8344a544c39b25eb6fc091da6bd0185db3423308a94c8ba2a4175228`.
- [https://openrouter.ai/api/v1/models](https://openrouter.ai/api/v1/models), 2026-10-02T14:01:17.895Z; SHA-256 `14ecaa9a09660cf88554b5b5004948a413e272d495336d34ddac62cefa830894`.
- [https://openrouter.ai/api/v1/models?output_modalities=image](https://openrouter.ai/api/v1/models?output_modalities=image), 2026-10-02T14:01:18.408Z; SHA-256 `56c76985af2c7eeb60b8205e7bf70dfabe0dd0c0aab1cf31b859f3d29420b09f`.
- [https://ai-gateway.vercel.sh/v1/models](https://ai-gateway.vercel.sh/v1/models), 2026-10-02T14:01:18.048Z; SHA-256 `1515f0e4e1cc6116d6c389c6b9ab53499de178bbb3054bb2d9207c2f1f8e2e52`.
- [https://integrate.api.nvidia.com/v1/models](https://integrate.api.nvidia.com/v1/models), 2026-10-02T14:01:17.725Z; SHA-256 `3c353e294b4b9deb1e9ae296a703f0f364dfb7fabc8a9f94554ea9d9fb9bb7c7`.

These are snapshots, not successful live inference or billing evidence.
Public feed captures and exported-object comparisons are retained under
`/tmp/linc-cd1716-artifacts.mNA27h`; they contain no private credentials.

## Release and rollout gates

Final local candidate artifacts were repacked/reinstalled after adding the
next Unreleased heading. Their installed audit remains zero; installed
document/policy/version assertions and real Node/Bun replies were rerun.

- Tarball: `/tmp/linc-cd1716-final-artifacts.IC4Uuk/casemark-linc-0.79.24.tgz`;
  SHA-256 `5799bf97f7837fce29f0785087325841faaf6ce2269f252a707ea9769d4295f3`.
- macOS ARM64 archive: `/tmp/linc-cd1716-final-artifacts.IC4Uuk/binary/pi-darwin-arm64.tar.gz`;
  SHA-256 `ca4bc6666694fc43f83ed66e5770b70b68720be90bba5bbc976346019db1c30f`.
- Installed evidence: `/tmp/linc-cd1716-final-artifacts.IC4Uuk/installed-proof.json`
  and `audit-installed.json`; full-suite log `/tmp/linc-cd1716-final-tests.log`.

The release PR remains draft until the intended deployment-provider smoke
or explicit human risk acceptance. Available OpenAI CLI credentials do not
certify Case.dev's gateway; no credential access is inferred from old task
history. Rebuild if packaged code/catalogs/notes change after this candidate.

Human review and a merge commit are required before the human publishing-tag
push. No local npm publish, tag push, image bake, runtime pointer, secret,
production flag, or deprecated C3 change is authorized by this candidate.
Only macOS ARM64 can be binary-smoked here; other binary targets depend on CI.

ESQ-C3 live acceptance follows publication and an isolated preview image:
private custom-skill create/save/edit/read/use; authorized vault document
delivery; unapproved host execution blocking; changed-manifest revocation;
and actual persistent-workspace reuse. Those checks remain required before
production activation. The MCP pilot remains opt-in.
