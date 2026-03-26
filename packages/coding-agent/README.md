# Linc

> Legal AI terminal agent powered by [case.dev](https://case.dev)

Linc is a terminal-native AI agent for legal workflows. One install, one API key, access to 195+ language models and the full case.dev platform via natural language.

## Install

```bash
npm install -g @casemark/linc
```

Or run directly:

```bash
npx @casemark/linc
```

## Setup

```bash
export CASEDEV_API_KEY="your-api-key"
linc
```

Get your API key at [case.dev](https://case.dev).

## What Can It Do?

Linc gives you a terminal AI agent with:

- **195+ LLM models** — Claude, GPT, Gemini, and more via case.dev's unified API
- **File operations** — read, edit, write, grep, find across your codebase
- **Shell access** — run commands, scripts, and pipelines
- **Legal workflows** — via the `casedev` CLI: vault management, OCR, transcription, legal research, semantic search
- **Session management** — persist, resume, branch, and compact conversations
- **Extensions** — extend with TypeScript plugins, custom tools, themes, skills, and prompt templates

## Usage

```bash
# Interactive mode (TUI)
linc

# Single-shot mode
linc -p "summarize this contract" @contract.pdf

# Continue previous session
linc -c

# Resume a specific session
linc -r

# Use a specific model
linc --model anthropic/claude-opus-4-6-20250725

# Pipe input
cat document.txt | linc -p "extract key terms"
```

## Architecture

- **LLM provider:** [case.dev /llm/v1](https://docs.case.dev/llms) — OpenAI-compatible, 195+ models
- **Auth:** Single `CASEDEV_API_KEY` — works for both the LLM endpoint and `casedev` CLI tools
- **Tools:** `bash` + `casedev` CLI (vault, OCR, voice, legal research, search)
- **Config:** `~/.linc/agent/` — settings, sessions, themes, extensions

## Extensions

Extend linc with TypeScript:

```typescript
import { defineExtension } from "@casemark/linc/hooks";

export default defineExtension({
  name: "my-extension",
  setup(hooks) {
    hooks.on("toolCall", async (event) => {
      // Custom tool handling
    });
  },
});
```

See [docs/extensions.md](docs/extensions.md) for the full API.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CASEDEV_API_KEY` | API key for case.dev (required) |
| `LINC_CODING_AGENT_DIR` | Override config directory (default: `~/.linc/agent`) |
| `LINC_OFFLINE` | Disable network operations at startup |
| `LINC_PACKAGE_DIR` | Override package directory (for Nix/Guix) |

## License

MIT — forked from [pi-mono](https://github.com/badlogic/pi-mono) (MIT)
