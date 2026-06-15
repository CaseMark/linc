# Release Process

Linc releases are prepared from GitHub Actions and published by the existing tag workflow.

## Automatic Release

Every non-release push to `main` automatically runs the `Release` workflow with a `patch` bump.

1. Merge a release-ready PR to `main`.
2. Wait for the `Release` workflow to install dependencies, run build/check/test, update versions and changelogs, commit release artifacts, and push the `vX.Y.Z` tag.
3. Approve the `npm-publish` environment gate in the tag-triggered `npm Publish` workflow.
4. Verify the package:

```bash
npm view @casemark/linc@X.Y.Z version
```

The release workflow ignores the release commits it creates (`Release vX.Y.Z` and `Add [Unreleased] section for next cycle`) so it does not loop after pushing back to `main`.

## Manual Release

Use the manual path when you need an explicit version or a `minor`/`major` bump.

1. Merge the release-ready changes to `main`.
2. Open the `Release` workflow in GitHub Actions.
3. Run the workflow from `main`.
4. Enter either an explicit version, such as `0.79.0`, or leave the version empty and choose `patch`, `minor`, or `major`.
5. Wait for the workflow to install dependencies, run build/check/test, update versions and changelogs, commit release artifacts, and push the `vX.Y.Z` tag.
6. Approve the `npm-publish` environment gate in the tag-triggered `npm Publish` workflow.
7. Verify the package:

```bash
npm view @casemark/linc@X.Y.Z version
```

The `Release` workflow does not publish directly. It pushes the release tag, then `.github/workflows/build-binaries.yml` builds binaries and creates or updates the GitHub release while `.github/workflows/npm-publish.yml` publishes `@casemark/linc` to npm with provenance.

## Required Setup

- The GitHub `npm-publish` environment must exist and should require reviewer approval.
- npm Trusted Publishing must allow `CaseMark/linc` to publish `@casemark/linc` from `.github/workflows/npm-publish.yml` with the `npm-publish` environment.
- The repository must allow the release workflow to push release commits and `v*` tags to `main`. If branch protection blocks `GITHUB_TOKEN` pushes, configure the workflow checkout with an approved release bot token.

## Recovery

If npm publishing fails after the release tag exists, rerun the `npm Publish` workflow manually with:

- `tag`: the release tag, such as `v0.79.0`
- `source_ref`: the same tag unless recovering from a known checkout issue

If the release workflow fails before the tag is pushed, fix the issue on `main` and rerun the `Release` workflow. The release script checks that the working tree is clean and that explicit versions are greater than the current version before it changes files.

If binary release creation fails after the release tag exists, rerun the `Build Binaries` workflow manually with the same `tag` and `source_ref` values.
