# Development

See [AGENTS.md](../../../AGENTS.md) for additional guidelines.

## Development Page Checklist

- [x] Setup points at the Linc repository and local source command.
- [x] Fork identity uses `lincConfig`, `bin.linc`, `.linc`, and `LINC_*` environment names.
- [x] Package asset paths are resolved through `src/config.ts`.
- [x] GUI source path resolution is exposed through `getWebUiExampleDir()`.
- [x] Debug output writes to the configured agent directory as `${APP_NAME}-debug.log`.
- [x] Test guidance matches this repository's agent rules.
- [x] Project structure includes the Linc packages used by this fork.

## Setup

```bash
git clone https://github.com/casemarkai/linc
cd linc
npm install
```

Run from source:

```bash
npx tsx packages/coding-agent/src/cli.ts
```

## Fork Identity

Configure via `package.json`:

```json
{
  "lincConfig": {
    "name": "linc",
    "configDir": ".linc"
  },
  "bin": {
    "linc": "dist/cli.js"
  }
}
```

Change `name`, `configDir`, and `bin` for a fork. These fields affect:

- CLI banner and command examples through `APP_NAME`
- user config paths through `CONFIG_DIR_NAME`
- environment variable names such as `LINC_CODING_AGENT_DIR`
- debug log file names such as `linc-debug.log`

Linc's package-local field is `lincConfig`, not upstream Pi's `piConfig`.

## Path Resolution

Three execution modes: npm install, standalone binary, tsx from source.

**Always use `src/config.ts`** for package assets:

```typescript
import { getPackageDir, getThemesDir, getWebUiExampleDir } from "./config.js";
```

Do not resolve package assets directly in feature code. Add a typed helper to `src/config.ts` first, then consume that helper from the CLI or mode implementation.

Current package asset helpers:

- `getPackageDir()`
- `getThemesDir()`
- `getExportTemplateDir()`
- `getPackageJsonPath()`
- `getReadmePath()`
- `getDocsPath()`
- `getExamplesPath()`
- `getWebUiExampleDir()`
- `getChangelogPath()`

## Debug Command

`/debug` (hidden) writes to `~/.linc/agent/linc-debug.log` by default:

- Rendered TUI lines with ANSI codes
- Last messages sent to the LLM

The exact location follows `getAgentDir()` and can be overridden with `LINC_CODING_AGENT_DIR`.

## Testing

```bash
npm run check
npx tsx ../../node_modules/vitest/dist/cli.js --run test/specific.test.ts
```

Run specific tests from the package root. If a test file is created or modified, run that exact test file and iterate until it passes.

Do not run `npm run dev`, `npm run build`, or `npm test` in normal agent work in this repository.

## Project Structure

```
packages/
  ai/            # OpenAI-compatible model access and shared AI utilities
  agent/         # Agent loop and message types
  tui/           # Terminal UI components
  coding-agent/  # CLI, interactive mode, gateway, RPC, config, themes
  mom/           # Multi-agent orchestration package
  pods/          # Pod/workspace support package
  web-ui/        # Browser UI package and local example app
```
