# Linc

Linc is a terminal-first AI coding agent configured for case.dev. It gives legal and technical teams a local agent interface, an OpenAI-compatible gateway for other tools, and a lightweight web UI for model and session workflows.

## What Linc Provides

- A local CLI agent for coding, research, and document-heavy work
- case.dev model access through one API key
- A local web UI for interactive sessions
- An OpenAI-compatible gateway for downstream tools
- Configurable themes, model scopes, sessions, and extensions

## Design

Linc keeps the agent runtime close to the machine where work happens. Files, shell commands, sessions, and local configuration stay under user control, while model traffic routes through case.dev.

## Start Here

Install Linc, authenticate with case.dev, then run the CLI:

```bash
npm install -g @casemark/linc
linc login
linc
```

For UI or integration workflows, see Web UI and Gateway.
