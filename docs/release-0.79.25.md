# Linc 0.79.25 release verification

Tracked in [CD-1732](https://linear.app/casemarkai/issue/CD-1732).
Base: main `5cec10eff9de61f000a944a772e2579fb1b8c905`.
Only `@casemark/linc` becomes 0.79.25; bundled pi packages and dependency
ranges remain 0.79.10. This is unpublished candidate evidence, not production
or live ESQ-C3 acceptance.

## Release audit — 2026-10-02

Relative to published 0.79.24, the implementation delta is [#82](https://github.com/CaseMark/linc/pull/82)
(CD-1374): vault/matter inventory helpers follow cursors, and the model-facing
object listing exposes paging, filename filtering, totals and an explicit
`INCOMPLETE` warning. [#83](https://github.com/CaseMark/linc/pull/83) and the
opt-in native document tool are already in 0.79.24; this release retains them.
The owner authorized an equivalent fresh `/cl` audit, build/test and Node/Bun
smoke on CD-1732. Previously released changelog sections are byte-identical.

## Verification

- Clean `npm ci --ignore-scripts`, full live-catalog build, Linc rebuild after
  versioning, `npm run check`, shrinkwrap/browser checks and publish dry run pass.
- Full non-live `./test.sh`: **2,748 passed, 822 skipped**, including all four
  release-bundle tests. Skipped tests are not live-provider coverage. Two initial
  default-parallel runs timed out in different existing Git reftable watcher
  tests. The focused watcher suite passed; the complete suite then passed with
  Vitest workers capped at two, without changing or skipping tests. Auth backup
  was restored on every run. Credential variables were excluded from the suite.
- Lockfile/shrinkwrap changes relative to main contain only Linc version fields;
  no runtime dependency upgrade or new lifecycle-script allowance is included.
- The actual packed tarball installs into an empty directory outside the repo
  with `--omit=dev --ignore-scripts`. Installed runtime audit: **zero findings**.
  Root development/example dependency advisories are separate and unchanged.
- Installed JS follows both object and vault pagination, rejects repeated
  cursors, passes filename/totals parameters, labels incomplete output, and
  rejects a disallowed vault before fetching. These are synthetic API tests,
  not a live customer-vault inventory test.
- Installed native DOCX creation passes ZIP/XML inspection, hostile-text
  escaping, mode 0600, exclusive creation and traversal rejection. The document
  tool and MCP extension JS hashes equal published 0.79.24. The full suite also
  passes MCP client/extension, policy and document regressions. No remote-skill
  execution approval is granted by these tests.
- Installed Node 22.22.2 and compiled macOS ARM64 Bun 1.3.4 pass version/help,
  model listing, read-only authentication selection, and actual authenticated
  print and interactive replies through `https://preview.api.case.dev`.
  Both automatically select `casemark-core` / `casemark/core-potassium`, with
  no provider/model flags. Replies: `CD1732_NODE_GATEWAY_OK` and
  `CD1732_BUN_GATEWAY_OK`. Both interactive sessions exit cleanly via `/quit`.
  Tools, sessions, custom extension/skill/context discovery and telemetry are
  disabled; isolated auth files have no saved providers. The preview key is
  supplied through hidden terminal input, never command arguments or files.
  Production credentials are not used. Other platforms and CI's Bun version
  require release CI; local macOS smoke does not certify Daytona.

## Catalog review

Exported-object comparison against `v0.79.24`: chat **1,433 → 1,438**, five
additions, zero removals, nine retained metadata changes. Image **59 → 59**,
with no semantic changes; generator formatting is normalized by the check.
No generator implementation is modified. All 14 added/changed chat entries
match source prices and context/output limits. Catalog metadata is a snapshot,
not live inference or billing evidence.

Added IDs:

- `amazon-bedrock/in.anthropic.claude-haiku-4-5-20251001-v1:0`
- `amazon-bedrock/in.anthropic.claude-opus-5`
- `amazon-bedrock/in.anthropic.claude-sonnet-5`
- `opencode/ling-3.1-flash-free`
- `openrouter/inclusionai/ling-3.1-flash`

All retained changes are OpenRouter price metadata; Nemotron also changes its
output limit from 16,384 to 182,520. Context limits and other fields are unchanged.
Prices below are USD per million tokens, not product pricing changes.

| OpenRouter ID | Input / output / cache-read |
| --- | --- |
| `deepseek/deepseek-v4-flash` | 0.028 / 0.056 / 0.0056 |
| `deepseek/deepseek-v4.1-flash` | 0.02 / 0.6 / 0.02 |
| `google/gemma-4-26b-a4b-it` | 0.0675 / 0.225 / 0.0375 |
| `nvidia/nemotron-3-ultra-550b-a55b` | 0.6 / 2.4 / 0.12 |
| `tencent/hy3` | 0.0825 / 0.33 / 0.020625 |
| `tencent/hy4-preview` | 0.7506 / 2.2509 / 0.0378 |
| `~deepseek/deepseek-flash-latest` | 0.02 / 0.6 / 0.02 |
| `~deepseek/deepseek-v4-flash-latest` | 0.005775 / 0.948024 / 0.00105 |
| `~z-ai/glm-flash-latest` | 0.02625 / 0.928749 / 0.01125 |

Captured verification sources, 2026-10-02T20:02:56Z:

- [models.dev](https://models.dev/api.json): SHA-256 `4cc8e010745b22f2a85e4caf1c0e3da9c46b28f32741f979cab3697c020b7192`.
- [OpenRouter](https://openrouter.ai/api/v1/models): SHA-256 `a730c5b951569851beffc262697a0064e944b25a9b428ee6be3b1873cfcc8bda`.
- [Vercel AI Gateway](https://ai-gateway.vercel.sh/v1/models): SHA-256 `1515f0e4e1cc6116d6c389c6b9ab53499de178bbb3054bb2d9207c2f1f8e2e52`.

## Candidate artifacts and rollout gates

Local evidence: `/tmp/linc-cd1732-artifacts.H0mv8c`; complete passing test log:
`/tmp/linc-cd1732-tests-bounded.log`. These temporary paths are not durable CI
artifacts or published downloads.

- Tarball SHA-256: `b219811a0d0c246373c7f913a3242dbba0564ad11794f6c67b8ee49163a77c0b`.
- macOS ARM64 archive SHA-256: `4011d4bdd1cf00d4d4666b2450c14fe132dd75be9fe349a4e981ab0629782ba5`.

The release commit contains the dated changelog and these verified package
contents. The separate next-Unreleased commit is development bookkeeping;
the local publishing tag targets the release commit, not that later heading.
Human review/merge with a merge commit and human publishing-tag push are
required. No local publication, remote tag push, snapshot bake, runtime-pointer
update, production flag or credential mutation is performed by this PR.

The 0.79.24 npm publish succeeded, but its subsequent preview Edge Config update
failed with an invalid Vercel token. Repair that CI credential separately or
explicitly skip that discovery update when publishing; it is not a new npm key.
Coordinate the eventual Case.dev preview pin with [single-pin PR #2495](https://github.com/CaseMark/casedotdev-mono/pull/2495)
instead of introducing competing version sources.

After publication: pin 0.79.25, validate an isolated preview snapshot, then run
ESQ-C3 private-skill create/save/edit/read/use, authorized document delivery,
unapproved-execution blocking, changed-manifest revocation and actual persistent
workspace acceptance. Production promotion remains a separate reviewed gate.
