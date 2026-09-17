# Release Process

CaseMark publishes only `@casemark/linc`. The three `@earendil-works/pi-*`
workspaces retain version 0.79.10 and their existing dependency ranges. Their
local builds and full runtime dependency closure are bundled into the Linc
tarball by `scripts/publish.mjs`; they are not published to upstream's npm scope.
This is an intentional exception to upstream pi's lockstep versioning.

## Prepare a release PR

1. Audit all changes since the previous release and update the Linc changelog.
2. Create `release/vX.Y.Z` from current `main` in an isolated worktree.
3. Use Node 22 and install with `npm ci --ignore-scripts`. Bump only Linc:

   ```bash
   npm version X.Y.Z --workspace @casemark/linc --no-git-tag-version --ignore-scripts
   npm install --package-lock-only --ignore-scripts
   npm run shrinkwrap:coding-agent
   ```

4. Turn the Linc `[Unreleased]` section into the dated release section. Build,
   run `npm run check`, and run `./test.sh` without live-provider credentials.
   The build regenerates model catalogs from live feeds. Review additions,
   removals, prices, and limits against those feeds; document removals in the
   release notes. Do not hand-edit generated catalogs.
5. Run `node scripts/publish.mjs --dry-run`. Then bundle, pack, and install the
   actual Linc tarball into an empty directory outside the repo:

   ```bash
   node scripts/bundle-pi-packages.mjs
   npm pack --workspace @casemark/linc --ignore-scripts --pack-destination <artifact-dir>
   node scripts/bundle-pi-packages.mjs --clean
   npm install --prefix <empty-install-dir> --omit=dev --ignore-scripts <artifact-dir>/casemark-linc-X.Y.Z.tgz
   ```

   Run bundle tests and packaging sequentially: they mutate the same temporary
   copies under `packages/coding-agent/node_modules`. Verify the installed Linc
   version, the bundled pi packages, and the specific shipped JS behavior being
   released. Checking workspace source alone does not prove the tarball.
6. Build the Bun binary. From outside the repo, verify Node and Bun version,
   help, model listing, authenticated print-mode completion, and an interactive
   completion with the intended default provider. Startup alone is insufficient.
   Keep credentials out of output and release artifacts. A missing or failed
   live-turn smoke keeps the release in draft unless Theodore accepts the risk.
7. Review lockfile and shrinkwrap diffs. Commit `Release vX.Y.Z`, then add a fresh
   `[Unreleased]` section and commit it. Prepare a local tag on the release
   commit; if follow-up fixes change the release, ensure the unpushed tag points
   to the final approved artifacts. Push only the branch and open a PR into main.

Do not use `npm version -ws`, `npm run version:patch`, or `scripts/release.mjs`.
They still assume upstream lockstep versioning. The automatic `Release` workflow
calls that script and is not the supported CaseMark release path. Its latest
attempt for 0.79.20 failed at the lockstep-version check.

## Merge and publish

Theodore merges the release PR **with a merge commit, not squash**, preserving
the tagged commit. After merge, Theodore pushes `vX.Y.Z`. Agents do not merge,
enable auto-merge, enqueue PRs, or push the publishing tag.

The tag triggers `Build Binaries` and `npm Publish`. Publishing uses GitHub
Actions OIDC and the `npm-publish` environment. Approve that environment if
GitHub requests approval, then verify:

```bash
npm view @casemark/linc@X.Y.Z version
```

Never move a pushed release tag or reuse an already-published npm version.

## Roll out to sandboxes

Prepare a casedotdev-mono PR into `preview` updating
`apps/router/server/utils/linc-version.ts`, the local image package manifest,
and their existing pin assertions. Keep the PR in draft until npm publishes
the version. Theodore merges it; the preview snapshot workflow then bakes and
validates the candidate. After the snapshot smoke passes, Theodore promotes
preview to main to deploy the production snapshot.

## Recovery

If publishing fails after the tag exists, inspect the failing job and rerun
`npm Publish` with the same `tag` and `source_ref`. The publish helper skips a
version already on npm. If binary publication fails, rerun `Build Binaries`
with that same tag. Do not invoke the lockstep release script as recovery.
