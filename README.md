# Unity

Unity keeps Agent Skills in one source-of-truth directory and mirrors them into the skill folders used by coding agents such as Codex, Claude Code, Cursor, and OpenCode.

The npm package is scoped as `@agent-skills/unity` because the unscoped `unity` package name is already taken. The executable is still `unity`.

## Install

```bash
npm install -g @agent-skills/unity
unity --help
```

```bash
bun add -g @agent-skills/unity
unity --help
```

For one-off use:

```bash
npx @agent-skills/unity sync
bunx @agent-skills/unity sync
```

## How it works

Unity has two source directories:

| Scope | Source of truth |
| --- | --- |
| User | `~/.agent/skills` |
| Project | `<repo>/.agent/skills` |

Each skill is a directory that contains `SKILL.md`:

```text
~/.agent/skills/
└── code-review/
    └── SKILL.md
```

`SKILL.md` must start with Agent Skills frontmatter:

```md
---
name: code-review
description: Review code changes for bugs, regressions, and missing tests.
---

Use this skill when reviewing a pull request or local diff.
```

## Quickstart

Initialize both user and project scopes:

```bash
unity init --scope all
```

Import existing skills from an agent directory:

```bash
unity import --from claude --scope user
unity import --from .cursor/skills --scope project
```

Sync once:

```bash
unity sync --scope all
```

Preview a sync without writing target directories or state:

```bash
unity sync --scope all --dry-run
```

Run a foreground watcher:

```bash
unity watch --scope all
```

## Built-in targets

| Agent | User target | Project target |
| --- | --- | --- |
| Codex | `~/.agents/skills` | `.agents/skills` |
| Claude Code | `~/.claude/skills` | `.claude/skills` |
| Cursor | `~/.cursor/skills` | `.cursor/skills` |
| OpenCode | `~/.config/opencode/skills` | `.opencode/skills` |

Cursor paths are included from the project requirements. Codex uses `.agents/skills` and `~/.agents/skills` according to current Codex docs.

## Safety model

Unity mirrors by copying directories, not by creating symlinks.

Unity tracks every file it writes in `.agent/state.json` or `~/.agent/state.json`. On future syncs it only overwrites or removes files when the target still matches Unity's manifest.

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

For a skill in `~/.cursor/skills/create-skill-local` with `name: create-skill`, this imports the skill into `~/.agent/skills/create-skill-local` and rewrites the copied `SKILL.md` to `name: create-skill-local`.

Preview imports first with:

```bash
unity import --from cursor --scope user --fix-names --dry-run
```
