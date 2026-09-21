# Linc 0.79.23 release verification

## Scope

This patch publishes the CD-1583 companion-resource URI fix merged in PR #77.
Case.dev MCP skill loads expose each manifest-listed supporting file's exact
URI, digest, and size, allowing Linc to read that verified URI on demand.
The feature remains opt-in; this release does not change the production flag
or Daytona snapshot pointer.

Only `@casemark/linc` moves to 0.79.23. The bundled `pi-agent-core`, `pi-ai`,
and `pi-tui` packages remain at 0.79.10. PR #78 changed tests only.

## Generated catalog review

The build refreshed the generated provider catalog from its live sources:
22 model entries were added and 9 were removed. The image-model catalog has
no semantic diff after formatting. This catalog refresh is independent of
the MCP fix and should be reviewed before publication.

Removed entries:

- `nvidia/deepseek-ai/deepseek-v4-flash-0731`
- `openrouter/anthropic/claude-opus-4`
- `openrouter/deepseek/deepseek-v4-flash-0731:free`
- `openrouter/minimax/minimax-m3:batch`
- `openrouter/moonshotai/kimi-k3:batch`
- `openrouter/openai/gpt-oss-120b:batch`
- `openrouter/qwen/qwen3.5-9b:batch`
- `openrouter/qwen/qwen3.8-2.4t-a95b:batch`
- `openrouter/thinkingmachines/inkling:batch`

The generated-file diff in this PR is the exact catalog refresh. Users who
selected one of these IDs must choose an available replacement with
`linc --list-models`.

## Validation

- `npm run build` and `npm run check`: passed.
- `./test.sh` after building: passed (agent 164, coding-agent 1,547,
  TUI 647; AI workspace passed with its live-provider tests skipped).
- `node scripts/publish.mjs --dry-run`: passed. The package contains the
  three bundled pi workspaces and their 99-package dependency closure.
- Isolated local release: Node package and macOS ARM64 binary both reported
  0.79.23, listed models, completed a real OpenAI print-mode prompt, and
  completed an interactive prompt.
- The initial offline test run before build failed to resolve workspace
  `dist` entrypoints. Building first and rerunning the suite passed.

## Publication and rollout

The automatic `Release` workflow currently fails because its lockstep
version check expects Linc and its bundled pi packages to share a version;
this fork intentionally versions Linc independently. Do not use that workflow
for this release. After human review and merge, a maintainer must push the
approved `v0.79.23` tag and approve the npm publishing environment. Verify
the published package before baking a preview-only Daytona snapshot.
