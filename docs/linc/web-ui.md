# Web UI

Linc includes a local browser interface for interactive sessions. It is useful when you want a persistent chat surface, visual session history, or a UI wrapper around the same case.dev-backed model access used by the CLI.

Start the local UI from a source checkout:

```bash
linc gui
```

The UI runs locally and connects to case.dev through the configured API key. It is intended as the base for a fuller hosted interface, not as the only way to use Linc.

## Public Hosted UI

For team deployments, the clean architecture is:

- Linc gateway or agent service on controlled infrastructure
- OpenAI-compatible API surface for UI compatibility
- Web UI or Open WebUI-compatible frontend on top
- case.dev API key management handled server-side

This keeps browser clients away from long-lived provider credentials and lets the organization control logging, access, and retention.
