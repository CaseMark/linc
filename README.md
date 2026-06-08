# Linc

Linc is a legal AI terminal agent built on top of the Pi agent harness.

The project goal is deliberately narrow:

- keep upstream Pi behavior as intact as possible;
- make Case.dev the first-class model and legal-workflow provider;
- ship built-in legal tools, skills, themes, and matter context;
- keep the Linc overlay small enough that upstream Pi changes can be merged without drama.

In short: Linc = Pi + legal workflows + Case.dev.

## Packages

| Package | Description |
| --- | --- |
| [`@casemark/linc`](packages/coding-agent) | Linc CLI and TUI |
| [`@earendil-works/pi-ai`](packages/ai) | Upstream Pi model/provider toolkit |
| [`@earendil-works/pi-agent-core`](packages/agent) | Upstream Pi agent runtime |
| [`@earendil-works/pi-tui`](packages/tui) | Upstream Pi terminal UI library |

## Linc Overlay Boundary

Linc-specific source lives in [`packages/coding-agent/src/linc`](packages/coding-agent/src/linc).

That directory owns:

- Case.dev auth and model loading;
- native Case.dev vault tools;
- vault session attachment;
- vault-backed `MATTER.md` materialization and sync;
- bundled legal skills;
- Linc startup policy.

Code outside that directory should stay close to upstream Pi unless the change is a small generic hook needed by the overlay.

## Quick Start

```bash
npm install -g --ignore-scripts @casemark/linc
export CASEDEV_API_KEY=sk_case_...
linc
```

Useful local development commands:

```bash
npm install --ignore-scripts
npm run check
npm run dark-linc
```

`dark-linc` is the local/internal development variant. It uses a separate config directory (`~/.dark-linc`) so experimental auth, sessions, and settings do not collide with normal `linc`.

## Case.dev Workflows

Linc uses one Case.dev API key for model access and legal workflow tools:

```bash
export CASEDEV_API_KEY=sk_case_...
```

Inside the TUI:

- `/login` configures Case.dev auth.
- `/model` selects dynamically fetched Case.dev models.
- `/vault` opens the vault selector.
- `/vault attach <vault-id>` attaches a Case.dev vault to the session.
- `/vault show` shows the attached vault.
- `/vault clear` or `/vault unlink` unlinks the vault.
- `/matter` shows the active matter file and vault.
- `/matter edit` opens `MATTER.md` in Linc's editor and syncs changes back to the vault.
- `/matter sync` manually syncs workspace `MATTER.md` back to the vault.
- `/init` starts guided legal matter initialization for the attached vault.
- `/autoinit` explores the attached vault and drafts `MATTER.md`, marking unsupported fields as `UNKNOWN`.

An attached vault is persisted in the session until `/vault clear`.

## MATTER.md

`MATTER.md` is Linc's durable legal matter context file.

When a vault is attached, Linc looks for `MATTER.md` in the vault, materializes it into the workspace, and loads it into the agent prompt. Edits to the workspace-root `MATTER.md` are synced back to the attached vault.

The file should contain durable matter-level state:

- representation and role;
- goals and open questions;
- jurisdiction and source rules;
- working preferences;
- short source-map pointers to vault documents;
- durable tasks and status.

It should not contain raw evidence dumps, full transcripts, credentials, scratchpad reasoning, or bulk legal research output.

## Development

After code changes:

```bash
npm run check
```

Run focused tests from the relevant package root:

```bash
cd packages/coding-agent
npx tsx ../../node_modules/vitest/dist/cli.js --run test/linc-vault-matter.test.ts
```

Do not use broad staging commands when committing. Stage only the files you changed.

## Upstream

Linc is a fork of Pi. The clean merge strategy is to keep Linc-specific behavior isolated under `packages/coding-agent/src/linc` and avoid runtime rewrites in Pi core.

When upstream Pi changes land, merge them into Linc, then resolve only the small set of intentional Linc overlay touchpoints.

## License

MIT
