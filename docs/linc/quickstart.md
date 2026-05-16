# Quickstart

Install Linc with npm:

```bash
npm install -g @casemark/linc
```

Authenticate with case.dev:

```bash
linc login
```

Start an interactive session:

```bash
linc
```

Run a one-off prompt:

```bash
linc --print "summarize this repository"
```

Attach files to a prompt:

```bash
linc "review this contract" ./agreement.pdf
```

List available models:

```bash
linc --list-models
```

Linc stores user configuration in `~/.linc/agent` by default.
