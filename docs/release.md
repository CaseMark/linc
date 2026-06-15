# Release Process

Linc releases are prepared from GitHub Actions and published by the existing tag workflow.

## Normal Release

1. Merge the release-ready changes to `main`.
2. Open the `Release` workflow in GitHub Actions.
3. Run the workflow from `main`.
4. Enter either an explicit version, such as `0.79.0`, or leave the version empty and choose `patch`, `minor`, or `major`.
5. Wait for the workflow to install dependencies, run build/check/test, update versions and changelogs, commit release artifacts, and push the `vX.Y.Z` tag.
6. Approve the `npm-publish` environment gate in the tag-triggered `Build Binaries` workflow.
7. Verify the package:

```bash
npm view @casemark/linc@X.Y.Z version
```

The `Release` workflow does not publish directly. It pushes the release tag, and `.github/workflows/build-binaries.yml` builds binaries, creates or updates the GitHub release, and publishes `@casemark/linc` to npm with provenance.

## Required Setup

- The GitHub `npm-publish` environment must exist and should require reviewer approval.
- npm Trusted Publishing must allow `CaseMark/linc` to publish `@casemark/linc` from `.github/workflows/build-binaries.yml` with the `npm-publish` environment.
- The repository must allow the release workflow to push release commits and `v*` tags to `main`. If branch protection blocks `GITHUB_TOKEN` pushes, configure the workflow checkout with an approved release bot token.

## Recovery

If tag publishing fails after the release tag exists, rerun the `Build Binaries` workflow manually with:

- `tag`: the release tag, such as `v0.79.0`
- `source_ref`: the same tag unless recovering from a known checkout issue

If the release workflow fails before the tag is pushed, fix the issue on `main` and rerun the `Release` workflow. The release script checks that the working tree is clean and that explicit versions are greater than the current version before it changes files.
