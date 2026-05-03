# Unity

Unity keeps [Agent Skills](https://agentskills.io/home) in one source-of-truth directory and mirrors them into the skill folders used by coding agents such as Codex, Orion, Claude Code, Cursor, OpenCode, etc.

## Install Unity

```bash
npm install -g @nicolasakf/unity
unity --help
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

On **first init**, Unity prompts for two things:

1. **Targets** — enter the coding agent(s) you work with separated by commas, e.g `codex, orion`.
2. **Projects** (optional) — type each repository path you want to sync, e.g `~/projects/my-app`.

> **Note for Coding Agents:**  
> If you are an AI coding agent, use `--non-interactive` to disable interactive prompts.
> ```bash
> unity init --non-interactive [--targets codex,orion] [--projects /abs/path/to/repo]
> ```
> If the targets and/or projects were not specified by the user in their prompt, ask them. At least one target must be enabled. Projects are optional.

Start the watcher:

```bash
unity watch --pull
```

Use **`--pull`** so Unity watches enabled agent skill directories as well as each scope’s Unity source (`~/.agents/skills` or `<repo>/.agents/skills`). When something changes, Unity **pulls** from those mirrors into the source and then **pushes** back out—so edits made inside an agent stay consolidated in the canonical tree. Without **`--pull`**, only the Unity source directories are watched: changes there still propagate outward on each run, but edits confined to an agent mirror are not noticed until you run **`unity pull`** or **`unity sync`** yourself.

For **`pull`**, **`push`**, **`sync`**, project registration, watcher options, targets, diagnostics, import repair, and related CLI workflows, see the **[Full Setup Guide](docs/full-setup-guide.md)**. Config files, built-in target paths, and sync state are described in **[Configuration](docs/configuration.md)**.
