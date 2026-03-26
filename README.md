# Linc

> Legal AI terminal agent powered by [case.dev](https://case.dev)

`npx linc` — auth — legal AI agent in your terminal.

## Quick Start

```bash
npm install -g @casemark/linc
export CASEDEV_API_KEY="your-key"
linc
```

## Packages

| Package | Description |
|---------|-------------|
| **[@casemark/linc](packages/coding-agent)** | Interactive terminal agent CLI |
| **[@casemark/linc-ai](packages/ai)** | LLM API via case.dev (195+ models) |
| **[@casemark/linc-agent-core](packages/agent)** | Agent runtime with tool calling and state management |
| **[@casemark/linc-tui](packages/tui)** | Terminal UI library with differential rendering |
| **[@casemark/linc-web-ui](packages/web-ui)** | Web components for AI chat interfaces |
| **[@casemark/linc-mom](packages/mom)** | Slack bot that delegates messages to linc |
| **[@casemark/linc-pods](packages/pods)** | CLI for managing vLLM deployments on GPU pods |

## Development

```bash
npm install          # Install all dependencies
npm run build        # Build all packages
npm run check        # Lint, format, and type check
```

## License

MIT — forked from [pi-mono](https://github.com/badlogic/pi-mono) (MIT)
