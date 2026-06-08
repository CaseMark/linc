# Linc

Linc is a legal AI terminal agent powered by Case.dev.

It is built on the Pi agent harness, with a deliberately small Linc overlay for legal workflows:

- Case.dev model auth and dynamic model discovery;
- native Case.dev vault tools;
- session-level vault attachment;
- vault-backed `MATTER.md` context;
- bundled legal skills;
- Linc themes and branding.

Linc should feel like Pi where Pi is already right, and feel like Case.dev where legal work needs first-class support.

## Install

```bash
npm install -g --ignore-scripts @casemark/linc
```

Configure Case.dev auth:

```bash
export CASEDEV_API_KEY=sk_case_...
linc
```

You can also run `/login` inside the TUI and choose Case.dev.

## Modes

```bash
linc                       # Interactive TUI
linc -p "Summarize this"   # Print mode
linc --mode json           # JSON event stream
linc --mode rpc            # RPC mode
```

For local development, use `dark-linc`:

```bash
dark-linc
```

`dark-linc` uses `~/.dark-linc` instead of `~/.linc`, so local experiments do not pollute normal Linc sessions or auth.

## Models

Linc fetches Case.dev models dynamically from the Case.dev LLM API at startup. Use `/model` or `Ctrl+L` to select a model.

Useful flags:

```bash
linc --provider casedev --model casemark/core-large
linc --list-models casemark
```

## Vaults

Linc can attach a Case.dev vault to a session.

```text
/vault
/vault attach <vault-id>
/vault show
/vault clear
/vault unlink
```

Attachment is session state. Once attached, the vault stays attached until `/vault clear`.

Native vault tools default to the attached vault when the model does not provide an explicit vault ID:

- `casedev_vault_list`
- `casedev_vault_get`
- `casedev_vault_object_list`
- `casedev_vault_search`
- `casedev_vault_upload`
- `casedev_vault_download`

## MATTER.md

`MATTER.md` is durable matter context for legal work.

When a vault is attached, Linc checks the vault for `MATTER.md`. If present, it materializes that file into the workspace and loads it into the agent prompt. If missing, interactive Linc can initialize one.

Workspace edits to root `MATTER.md` are synced back to the attached vault.

Human-facing commands:

```text
/matter
/matter edit
/matter sync
/init
/autoinit
```

Native matter tools:

- `casedev_matter_read`
- `casedev_matter_write`
- `casedev_matter_edit`

Use `MATTER.md` for durable matter state: representation, goals, jurisdiction, source rules, open questions, working preferences, and source-map pointers. Do not store raw evidence, credentials, transcript dumps, or scratchpad reasoning in it.

## Commands

| Command | Description |
| --- | --- |
| `/login` | Configure Case.dev auth |
| `/model` | Select a model |
| `/theme` | Select a theme |
| `/vault` | Select or attach a Case.dev vault |
| `/vault show` | Show attached vault |
| `/vault clear` | Unlink the attached vault |
| `/vault unlink` | Unlink the attached vault |
| `/matter` | Show active MATTER.md state |
| `/matter edit` | Edit MATTER.md and sync it to the attached vault |
| `/matter sync` | Sync MATTER.md to the attached vault |
| `/init` | Start guided matter initialization |
| `/autoinit` | Explore the attached vault and draft MATTER.md with unknowns marked |
| `/resume` | Pick from previous sessions |
| `/new` | Start a new session |
| `/compact [prompt]` | Compact context |
| `/reload` | Reload resources |
| `/quit` | Quit |

## Files And State

| Path | Purpose |
| --- | --- |
| `~/.linc` | Normal Linc config, sessions, auth, packages |
| `~/.dark-linc` | Local development config for `dark-linc` |
| `MATTER.md` | Workspace materialization of attached-vault matter context |
| `packages/coding-agent/src/linc` | Linc-specific overlay source |

## Development

From the repository root:

```bash
npm install --ignore-scripts
npm run check
npm run dark-linc
```

Run focused tests from this package root:

```bash
npx tsx ../../node_modules/vitest/dist/cli.js --run test/linc-vault-matter.test.ts
```

## Upstream Boundary

Linc is a fork of Pi. Keep Linc-specific behavior in `src/linc` unless a small generic hook belongs in Pi core. This keeps upstream merges tractable and makes the product boundary obvious to new contributors.

## License

MIT
