# Release

Linc uses `dev` as the stable pre-release branch and `main` as the release branch.

## Branch Contract

- Develop on feature branches.
- Merge feature branches into `dev`.
- Keep `dev` green and usable for pre-release validation.
- Promote `dev` to `main` only when the current pre-release set is ready to publish.
- Keep `main` releasable at all times.
- Do not merge `pi/main` directly into Linc. Review upstream with `npm run upstream:pi`, then port selected changes explicitly.

## Release Pipeline

The intended release path is branch promotion plus GitHub Actions:

1. Merge feature branches into `dev`.
2. Run checks and pre-release smoke from `dev`.
3. Promote `dev` to `main` with a normal merge when ready to publish.
4. Run the `Release Prep` workflow on `main` with `patch`, `minor`, `major`, or an exact version.
5. The workflow runs `scripts/prepare-release.mjs`, updates workspace versions, syncs package versions, promotes changelog `Unreleased` sections, runs `npm run check`, commits, and tags `vX.Y.Z`.
6. The `NPM Publish` workflow runs from the tag and publishes the public packages.
7. The `NPM Publish Check` workflow dry-runs package contents on PRs and pushes when the local version is not already published.

The local `scripts/release.mjs` path is legacy. Prefer the GitHub workflow so versioning, tagging, and npm publishing happen from a clean `main` checkout.

## Published Packages

The bundle package is `@casemark/linc`. It exposes selected package surfaces under Linc subpaths:

- `@casemark/linc/agent-core`
- `@casemark/linc/ai`
- `@casemark/linc/ai/oauth`
- `@casemark/linc/tui`

Linc still carries the internal workspace packages because upstream Pi is the source of truth for most implementation code.

## case.dev Runtime Coupling

case.dev `/linc/v1` does not consume the local worktree. It consumes the published `@casemark/linc` package pinned in the case.dev Linc runtime image.

Before bumping that pin in case.dev:

1. Confirm `linc --mode rpc --provider casedev --model <model>` still starts.
2. Confirm RPC command bodies remain native Pi/Linc JSON and are accepted unchanged.
3. Confirm event frame names stay compatible with C3: `message_update`, `message_end`, `turn_end`, `agent_end`, and `tool_execution_*`.
4. Confirm `turn_end` with `stopReason: "toolUse"` is not treated as final completion by downstream clients.
5. Confirm headless auth still honors `CASEDEV_API_KEY`.
6. Smoke case.dev preview and C3 before promoting the case.dev runtime image or package pin.
