# Gateway

Linc can expose an OpenAI-compatible local gateway. This is the compatibility layer for tools and UI wrappers that expect `/v1/models` and `/v1/chat/completions`.

Start the gateway:

```bash
linc gateway
```

Use a custom host or port:

```bash
linc gateway --host 127.0.0.1 --port 8642
```

Health check:

```bash
curl http://127.0.0.1:8642/health
```

List models:

```bash
curl http://127.0.0.1:8642/v1/models
```

The gateway is designed for compatibility, not as a broad provider router. Linc routes model access through case.dev.
