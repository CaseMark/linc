# Linc changelog audit — 2026-10-01

Scope: last release `v0.79.23` (`3a177e5a`) through merged `main`
`a0d00b7d7aebaac7f3113f57ff13f66d042d6d64`. The owner explicitly authorized
the agent to perform the repository's `/cl` audit instead of the required
human invocation. This is a changelog-coverage audit, not release approval,
a new security review, or live ESQ-C3 acceptance.

## Commit coverage

| Change | Audit result |
| --- | --- |
| `a56649ff` / CD-1243 / #19: version-discovery update after publish | Missing operational note added to Linc. Workflow defaults to preview; production/both require an explicit dispatch choice. No snapshot bake or promotion is performed by this update. |
| `40a9843d` / CD-1623 / #80: catalog-price precision | Existing Linc entry retained; missing AI package entry added. Existing catalog-refresh counts described only #80, so Linc now records the cumulative audited snapshot. |
| `1d9ffd3b` / CD-1624 / #81: retire Union Alpha shim | Existing Linc entry is accurate: explicit-provider unknown IDs become custom IDs with a warning; saved/restored choices use generic fallbacks. No named automatic migration remains. |
| `ebbae337` / CD-1709 / #83: provider defaults and catalog-backed tests | Missing Linc default-selection entry and AI fixture/typechecking entry added. Only Fireworks, Together, and OpenCode Go defaults move to K3. Explicit saved model selections are not rewritten. |
| `4f6045e2` / CD-1703 / #84: native document tool | Missing Linc Added entry added, linked to the trust-boundary/runbook documentation. Opt-in, text-only, no implicit execution approval, no live-delivery claim. |
| Merge commits and `f282ea18`: Unreleased heading | Housekeeping; no separate product-facing entry. |

The price-conversion change is duplicated into Linc because it ships the AI
package. The Kimi AI edits are test fixtures and generated metadata, not a
new provider implementation; the actual end-user default-selection change
is recorded in Linc. Agent-core and TUI source are unchanged since the tag.
Their older Unreleased notes are preserved, not relabelled as new changes.
The older AI `onResponse` entry is also preserved; it predates this range.

The `/cl` prompt requests user confirmation before writing a New Features
highlight. Proposed highlight: text-based Word creation after MCP skill
loading without approving remote code execution. It is not written pending
that confirmation; the factual Added entry is independent of the highlight.

## Catalog scope

Compared exported catalog objects from the tagged and audited committed
TypeScript files, not textual line counts or a live-provider query:

- Chat: 1,354 to 1,433 entries; 113 added, 34 removed, 306 retained entries
  with metadata differences. The last count includes precision-only changes
  and must not be described as 306 pricing changes.
- Image: 54 to 57 entries; three added, none removed, three retained entries
  with metadata differences.
- Image additions: `openrouter/inclusionai/ming-image-0.1-design`,
  `openrouter/inclusionai/ming-image-0.1-design-layer`, and
  `openrouter/recraft/recraft-v4.1-flash`.

Generated files alone are skipped for feature coverage under `/cl`.
The removal list is recorded because current provider defaults and existing
release notes make that catalog refresh intentional and product-facing.
A release build will regenerate catalogs from current feeds. Its final
delta and source evidence must be audited separately before publishing;
these counts only certify the named `main` snapshot.

## Catalog removals

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
- `together/moonshotai/Kimi-K2.6`
- `together/moonshotai/Kimi-K2.7-Code`
- `vercel-ai-gateway/inclusionai/ling-3.0-flash-fin-free`
- `vercel-ai-gateway/inclusionai/ling-3.0-flash-vl-free`

## Release and rollout gates

Only `@casemark/linc` is published. The three bundled upstream-named pi
packages stay at 0.79.10. The next release requires final catalog review,
static/non-live tests, actual packed-install verification, Node and Bun
checks, and authenticated print and interactive completions. A startup-only
check is insufficient. Publishing tags remain a human action.

The document-tool rollout remains isolated to ESQ-C3 and a disposable QA
matter/vault. Real delivery, unapproved-script blocking, changed-manifest
revocation, and actual persistent-workspace behavior require acceptance
before any production activation. No production flag, global runtime
pointer, version-discovery key, credential, or deprecated C3 code was
changed by this audit.

## 2026-10-02 supplement

The final release base is merged main `5a4804d51a9f57749bad14def0c894c12377ca00`.
CD-1717 / #86 adds reviewed protobufjs 7.6.5 and ws 8.21.0 runtime patches,
bundle regressions, the current Together test fixture, and sequential
packaging verification. The Linc release changelog records this patch.
Earlier counts/removals above certify only the named October 1 committed
snapshot. The final release's 37 removals and source-backed metadata delta
are recorded in [release verification](release-0.79.24.md#catalog-removals).
The owner authorized continuing the existing /cl-equivalent audit; no optional
marketing highlight, human release approval, or publication is inferred.
