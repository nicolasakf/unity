# Unity

Unity keeps Agent Skills in one source-of-truth directory and mirrors them into the skill folders used by coding agents such as Codex, Orion, Claude Code, Cursor, OpenCode, etc.

## Install Unity

```bash
npm install -g @nicolasakf/unity
unity --help
```

One-off without a global install:

```bash
npx @nicolasakf/unity sync
```

## How it works

Unity has two source directories:

| Scope | Source of truth |
| --- | --- |
| User | `~/.agents/skills` |
| Project | `<repo>/.agents/skills` |

Unity uses these as the source of truth for the skills. You or your agent can edit the skills in the source directory or in the agent mirror directory. Unity will guarantee that all linked directories (targets) are kept in sync at each scope level.

## Quickstart

Initialize user-level Unity:

```bash
unity init
```

`init` also creates a user-level `unity-skill` from this README and pushes it to enabled user targets, so coding agents can learn how Unity works.

On **first init** in an interactive terminal, Unity prompts for two things:

1. **Targets** — enter comma-separated built-in ids (codex, claude, cursor, …), or Enter to disable all. That choice is stored for **both** user- and project-scoped sync; new project configs copy it from your user config so you do not get every agent enabled at the repo level by default.
2. **Projects** (optional) — type each repository root, then Enter to register it with `unity watch`; press Enter on an empty line when you are finished, or press **Escape** to stop adding paths.

Coding agents or scripts cannot use interactive prompts. Run init without prompts like this:

```bash
unity init --non-interactive [--targets codex,orion] [--projects /abs/path/to/repo]
```

Equivalent environment variables (`UNITY_INIT_TARGETS`, `UNITY_INIT_PROJECTS`; set `UNITY_INIT_NON_INTERACTIVE=1` to force non-interactive even in a tty) are documented under [configuration](docs/configuration.md#non-interactive-init).

Import existing skills from an agent directory:

```bash
unity import --from claude --scope user
unity import --from .cursor/skills --scope project
```

Pull new skills from all enabled agent directories into Unity:

```bash
unity pull --scope all
```

Push Unity skills out to enabled agent directories:

```bash
unity push --scope all
```

`unity sync` is kept as an alias for the push direction.

Preview a push without writing target directories or state:

```bash
unity push --scope all --dry-run
```

Register projects for the global watcher:

```bash
unity projects add ~/path/to/repo
unity projects list
```

Run one global background watcher for user scope and all registered projects:

```bash
unity watch --pull
```

Unity keeps a single watcher registration at `~/.agents/watch.json`. Starting `unity watch` again replaces any already-running Unity watcher, so changing flags is as simple as running the new command:

```bash
unity watch --scope project --pull
```

Check the registered watcher:

```bash
unity watch-status
```

For a one-off watcher in the current repository only:

```bash
unity watch --scope project --pull
```

Keep the watcher attached to the current terminal:

```bash
unity watch --pull --foreground
```

## Built-in targets

| Agent | User target | Project target |
| --- | --- | --- |
| Codex | `~/.agents/skills` | `.agents/skills` |
| Orion | `~/.agents/skills` | `.agents/skills` |
| Claude Code | `~/.claude/skills` | `.claude/skills` |
| Augment | `~/.augment/skills` | `.augment/skills` |
| Cursor | `~/.cursor/skills` | `.cursor/skills` |
| Devin | `~/.config/devin/skills` | `.devin/skills` |
| Factory | `~/.factory/skills` | `.factory/skills` |
| Goose | `~/.config/goose/skills` | `.goose/skills` |
| OpenClaw | `~/.openclaw/skills` | `.agents/skills` |
| OpenCode | `~/.config/opencode/skills` | `.opencode/skills` |
| OpenHands | `~/.openhands/skills` | `.openhands/skills` |
| Qwen Code | `~/.qwen/skills` | `.qwen/skills` |
| Windsurf | `~/.codeium/windsurf/skills` | `.windsurf/skills` |

Codex, Orion, and project OpenClaw use the Unity source directory directly: `.agents/skills` and `~/.agents/skills`.

## Safety model

Unity mirrors by copying directories, not by creating symlinks.

Unity's push direction writes from `.agents/skills` into enabled agent targets. Codex, Orion, and project OpenClaw already read that source path, so Unity skips those targets as copy destinations. The pull direction imports new skills from targets into `.agents/skills`; it skips source skills that already exist unless you use the explicit import workflow to handle a specific target.

Unity tracks every file it writes in `.agents/state.json` or `~/.agents/state.json`. On future syncs it only overwrites or removes files when the target still matches Unity's manifest.

If a target skill exists but Unity did not create it, sync skips it and reports a warning. Use `--force` to overwrite:

```bash
unity sync --force
```

When a source skill is removed, Unity removes the previously managed target copy. If that target copy was edited outside Unity, removal is skipped unless `--force` is used.

Unity also creates a per-scope lock file while mutating files so two `unity sync` or `unity watch` processes cannot update the same scope at the same time.

## Target management

List targets:

```bash
unity targets list
```

Disable Claude sync without deleting mirrored files:

```bash
unity targets disable claude --scope all
```

Disable Claude sync and delete only Unity-managed Claude skills:

```bash
unity targets disable claude --scope all --prune
```

Add a custom target:

```bash
unity targets add my-agent \
  --user-path ~/.my-agent/skills \
  --project-path .my-agent/skills
```

## Project watcher registry

`unity watch` defaults to a global watcher. It watches the user source plus every project registered in `~/.agents/config.json`.

```bash
unity projects add .
unity projects remove .
unity projects list
unity watch --pull
```

The watcher also watches the user config file, so `unity projects add <path>` can add a project to an already-running global watcher.

Use `--scope user`, `--scope project`, or `--scope all` when you want an old-style scoped watcher for one shell session instead of the global registry.

## Status and diagnostics

```bash
unity status
unity status --verbose
unity doctor
unity doctor --fix
```

`doctor` validates source skills and prints the resolved paths for every configured target.

`doctor --fix` creates missing Unity source/config directories and enabled target directories.

## Import repair

Some existing agent skills have a folder name that does not match the `name:` field in `SKILL.md`. Unity keeps source validation strict, but import can repair copied skills without changing the original agent directory:

```bash
unity import --from cursor --scope user --fix-names
```

For a skill in `~/.cursor/skills/create-skill-local` with `name: create-skill`, this imports the skill into `~/.agents/skills/create-skill-local` and rewrites the copied `SKILL.md` to `name: create-skill-local`.

Preview imports first with:

```bash
unity import --from cursor --scope user --fix-names --dry-run
```
