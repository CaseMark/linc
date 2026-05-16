# Configuration

Linc uses case.dev as its model provider. Authenticate once with:

```bash
linc login
```

You can also provide an API key through the environment:

```bash
export CASEDEV_API_KEY=sk_case_...
```

## Config Directory

By default, Linc stores user-level files under:

```bash
~/.linc/agent
```

Override that location with:

```bash
export LINC_CODING_AGENT_DIR=/path/to/agent-config
```

## Common Files

- `auth.json` stores authentication state
- `settings.json` stores user settings
- `models.json` stores model preferences and scopes
- `themes/` stores custom themes
- `sessions/` stores local session history

Project-level settings can live in `.linc/settings.json`.
