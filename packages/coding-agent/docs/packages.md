> Linc can help you create Linc packages. Ask it to bundle your extensions, skills, prompt templates, themes, or model provider plugins.

# Linc Packages

Linc packages bundle extensions, skills, prompt templates, and themes so you can share them through npm, git, or a local path. A package can declare resources in `package.json` under the `linc` key, or use conventional directories. Legacy `pi` manifests still load for compatibility.

## Table of Contents

- [Install and Manage](#install-and-manage)
- [Package Sources](#package-sources)
- [Creating a Linc Package](#creating-a-linc-package)
- [Package Structure](#package-structure)
- [Provider Plugins](#provider-plugins)
- [Dependencies](#dependencies)
- [Package Filtering](#package-filtering)
- [Enable and Disable Resources](#enable-and-disable-resources)
- [Scope and Deduplication](#scope-and-deduplication)

## Install and Manage

> **Security:** Linc packages run with full system access. Extensions execute arbitrary code, and skills can instruct the model to perform actions including running executables. Review source code before installing third-party packages.

```bash
linc install npm:@foo/bar@1.0.0
linc install git:github.com/user/repo@v1
linc install https://github.com/user/repo  # raw URLs work too
linc install /absolute/path/to/package
linc install ./relative/path/to/package

linc remove npm:@foo/bar
linc list    # show installed packages from settings
linc update  # update all non-pinned packages
```

By default, `install` and `remove` write to global settings (`~/.linc/agent/settings.json`). Use `-l` to write to project settings (`.linc/settings.json`) instead. Project settings can be shared with your team, and Linc installs any missing packages automatically on startup.

To try a package without installing it, use `--extension` or `-e`. This installs to a temporary directory for the current run only:

```bash
linc -e npm:@foo/bar
linc -e git:github.com/user/repo
```

## Package Sources

Linc accepts three source types in settings and `linc install`.

### npm

```
npm:@scope/pkg@1.2.3
npm:pkg
```

- Versioned specs are pinned and skipped by `linc update`.
- Global installs use `npm install -g`.
- Project installs go under `.linc/npm/`.
- Set `npmCommand` in `settings.json` to pin npm package lookup and install operations to a specific wrapper command such as `mise` or `asdf`.

Example:

```json
{
  "npmCommand": ["mise", "exec", "node@20", "--", "npm"]
}
```

### git

```
git:github.com/user/repo@v1
git:git@github.com:user/repo@v1
https://github.com/user/repo@v1
ssh://git@github.com/user/repo@v1
```

- Without `git:` prefix, only protocol URLs are accepted (`https://`, `http://`, `ssh://`, `git://`).
- With `git:` prefix, shorthand formats are accepted, including `github.com/user/repo` and `git@github.com:user/repo`.
- HTTPS and SSH URLs are both supported.
- SSH URLs use your configured SSH keys automatically and respect `~/.ssh/config`.
- For non-interactive runs, set `GIT_TERMINAL_PROMPT=0` to disable credential prompts and set `GIT_SSH_COMMAND` to fail fast.
- Refs pin the package and skip `linc update`.
- Cloned to `~/.linc/agent/git/<host>/<path>` globally or `.linc/git/<host>/<path>` for a project.
- Runs `npm install` after clone or pull if `package.json` exists.

### Local Paths

```
/absolute/path/to/package
./relative/path/to/package
```

Local paths point to files or directories on disk and are added to settings without copying. Relative paths are resolved against the settings file they appear in. If the path is a file, it loads as a single extension. If it is a directory, Linc loads resources using package rules.

## Creating a Linc Package

Add a `linc` manifest to `package.json` or use conventional directories. Include the `linc-package` keyword for discoverability.

```json
{
  "name": "my-package",
  "keywords": ["linc-package"],
  "linc": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

Paths are relative to the package root. Arrays support glob patterns and `!exclusions`.

## Package Structure

### Convention Directories

If no `linc` or legacy `pi` manifest is present, Linc auto-discovers resources from these directories:

- `extensions/` loads `.ts` and `.js` files
- `skills/` recursively finds `SKILL.md` folders and loads top-level `.md` files as skills
- `prompts/` loads `.md` files
- `themes/` loads `.json` files

## Provider Plugins

Model provider packages are normal Linc packages that ship an extension. The extension calls `registerProvider()` to add or override a model provider, including custom OpenAI-compatible base URLs.

```json
{
  "name": "@acme/linc-provider-local",
  "keywords": ["linc-package", "linc-provider"],
  "linc": {
    "extensions": ["./dist/index.js"]
  }
}
```

See [Custom Providers](./custom-provider.md) for provider extension examples.

## Dependencies

Third-party runtime dependencies belong in `dependencies` in `package.json`. Dependencies that do not register extensions, skills, prompt templates, or themes also belong in `dependencies`. When Linc installs a package from npm or git, it runs `npm install`, so those dependencies are installed automatically.

Linc bundles core packages for extensions and skills. If you import any of these, list them in `peerDependencies` with a `"*"` range and do not bundle them: `@casemark/linc`, `@casemark/linc-ai`, `@casemark/linc-agent-core`, `@casemark/linc-tui`, `@sinclair/typebox`.

Other Linc packages must be bundled in your tarball. Add them to `dependencies` and `bundledDependencies`, then reference their resources through `node_modules/` paths. Linc loads packages with separate module roots, so separate installs do not collide or share modules.

Example:

```json
{
  "dependencies": {
    "shared-linc-tools": "^1.0.1"
  },
  "bundledDependencies": ["shared-linc-tools"],
  "linc": {
    "extensions": ["extensions", "node_modules/shared-linc-tools/extensions"],
    "skills": ["skills", "node_modules/shared-linc-tools/skills"]
  }
}
```

## Package Filtering

Filter what a package loads using the object form in settings:

```json
{
  "packages": [
    "npm:simple-pkg",
    {
      "source": "npm:my-package",
      "extensions": ["extensions/*.ts", "!extensions/legacy.ts"],
      "skills": [],
      "prompts": ["prompts/review.md"],
      "themes": ["+themes/legacy.json"]
    }
  ]
}
```

`+path` and `-path` are exact paths relative to the package root.

- Omit a key to load all of that type.
- Use `[]` to load none of that type.
- `!pattern` excludes matches.
- `+path` force-includes an exact path.
- `-path` force-excludes an exact path.
- Filters layer on top of the manifest. They narrow down what is already allowed.

## Enable and Disable Resources

Use `linc config` to enable or disable extensions, skills, prompt templates, and themes from installed packages and local directories. Works for both global (`~/.linc/agent`) and project (`.linc/`) scopes.

## Scope and Deduplication

Packages can appear in both global and project settings. If the same package appears in both, the project entry wins. Identity is determined by:

- npm: package name
- git: repository URL without ref
- local: resolved absolute path
