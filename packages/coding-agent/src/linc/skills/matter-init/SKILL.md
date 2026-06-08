---
name: linc-matter-init
description: Guide legal matter intake or auto-initialization and turn durable answers into MATTER.md using Linc's native matter tools.
---

# Linc Matter Init

Use this skill when the user runs `/init`, runs `/autoinit`, or asks to initialize matter context.

Your job is to build or improve `MATTER.md`, the durable whiteboard for the attached legal matter. Keep the intake short. Do not ask for every possible fact up front.

## Workflow

1. If `MATTER.md` may already exist, call `casedev_matter_read` first.
2. Ask only the missing questions needed to create useful durable context.
3. Prefer one compact intake round with 4-6 questions.
4. If the user gives enough information, update `MATTER.md` with `casedev_matter_write` or `casedev_matter_edit`.
5. If the user does not give enough information, ask the next narrow question instead of writing filler.

## Auto-Init Mode

When the user runs `/autoinit`, do the exploratory work before asking questions.

1. Call `casedev_matter_read` first if `MATTER.md` may already exist.
2. Inspect the attached vault with native vault tools such as `casedev_vault_get`, `casedev_vault_object_list`, and targeted `casedev_vault_search` queries.
3. Build the best durable `MATTER.md` the vault supports.
4. Write `UNKNOWN` exactly for fields the vault does not support.
5. Ask the user only when auth, vault access, or missing source material blocks the run.

Do not infer party roles, goals, jurisdiction, claims, defenses, deadlines, or source rules unless the vault actually supports them.

## Intake Questions

Ask for these only when they are missing or unclear:

- Matter title or short caption.
- Who the user represents, or whether this is neutral/internal analysis.
- Immediate goal for this session or matter.
- Jurisdiction, forum, or governing law if known.
- Source-of-truth and citation rules.
- One or two durable open questions or next tasks.

## MATTER.md Rules

`MATTER.md` should contain durable matter-level context only:

- What the matter is.
- Representation posture.
- Goals.
- Jurisdiction/forum/governing law.
- Source rules and citation preferences.
- Stable decisions.
- Open questions.
- Durable tasks.
- Short source-map entries pointing to vault objects or documents.

Do not put these in `MATTER.md`:

- Full document text.
- OCR dumps.
- Transcript dumps.
- Long legal research dumps.
- Raw evidence.
- Chat history.
- Scratchpad reasoning.
- Credentials or sync tokens.

Keep `MATTER.md` concise, preferably under 500 lines. Use plain Markdown.

## Native Tools

Use `casedev_matter_read` to inspect current context.

Use `casedev_matter_edit` for targeted updates to existing `MATTER.md`.

Use `casedev_matter_write` for first creation or deliberate full rewrites. When writing from scratch, use this structure:

```markdown
---
mattermd: "0.1"
title: "<matter title>"
---

# Matter

## What This Is

## Representation

## Goals

## Jurisdiction

## Source Rules

## Working Preferences

## Source Map

| Label | Source | Notes |
|---|---|---|

## Working State

## Open Questions

| Question | Why It Matters | Status |
|---|---|---|

## Board

| Status | Task | Notes |
|---|---|---|
```
