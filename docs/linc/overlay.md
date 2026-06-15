# Linc Overlay

Linc is a thin legal AI distribution of Pi. The rule is:

```text
Linc = Pi + package identity + case.dev auth + legal tools + bundled legal skills + Linc themes
```

Pi owns the runtime:

- agent loop
- TUI rendering
- extension loading
- tool execution
- model registry mechanics
- session storage
- compaction
- package management

Linc owns the distribution overlay:

- `@casemark/linc` package identity
- `linc` and local-only `dark-linc` entrypoints
- `.linc` and `.dark-linc` config roots
- case.dev auth/provider defaults
- first-party case.dev/legal extensions
- bundled legal skills
- Linc themes
- release/publish wiring for the Linc package

## Upstream Merge Rule

Upstream Pi merges should be allowed to replace Pi-owned files. Linc-specific behavior should live in Linc-owned paths or behind small generic hooks.

Preferred Linc-owned paths:

- `docs/linc/**`
- `packages/coding-agent/src/linc/**`
- `packages/coding-agent/src/modes/interactive/theme/linc-*.json`
- release scripts that explicitly publish `@casemark/linc`
- `.github/upstream-pi.json`

Allowed Pi integration hooks are small and generic. The current example is `piConfig.variants`, which lets one package expose multiple entrypoints with separate config roots.

Do not add case.dev behavior directly to the agent loop, model registry, TUI renderer, session manager, or tool executor. If Linc needs behavior there, first add a generic Pi-shaped hook, then consume it from the Linc overlay.

## Current Overlay

- `linc` uses app name `linc` and config root `~/.linc/agent`.
- `dark-linc` is the local experimental entrypoint for testing branch builds without touching the normal Linc config.
- `dark-linc` uses app name `dark-linc` and config root `~/.dark-linc/agent`.
- `PI_CONFIG_VARIANT=dark-linc` can force the dark-linc variant when launching from source.
- Built-in Linc themes are `linc-brief`, `linc-chambers`, `linc-docket`, `linc-neo`, and `linc-witness`.
