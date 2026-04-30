# Agent Setup Guide

This guide is written for coding agents setting up Unity for a user.

## Install

```bash
npm install -g @nicolasakf/unity
```

Verify:

```bash
unity --help
```

## Initialize

For the user-wide skills source:

```bash
unity init
```

`init` creates a user-level `unity-skill` from Unity's README and pushes it to enabled user targets. This helps coding agents understand the user's Unity setup.

On **first init** in an interactive terminal, Unity first asks which built-in targets to enable (comma-separated ids). Then it optionally registers **project roots** for the global watcher: type each path and press Enter to add it; press Enter on an empty line when done, or press **Escape** to stop adding paths. Each registration creates that project’s Unity scope (including `.agents` under that repo).

**Agents cannot use interactive stdin.** Initialize without prompts so the command exits immediately:

```bash
UNITY_INIT_TARGETS=codex,claude UNITY_INIT_PROJECTS=/path/to/repo unity init --non-interactive
```

Or use CLI flags instead of env vars:

```bash
unity init --non-interactive --targets codex,cursor --projects "$HOME/workbench/my-app"
```

With `--non-interactive` and no `--targets` / no `UNITY_INIT_TARGETS`, all built-in user targets stay **disabled** (same as pressing Enter alone at the targets prompt). With no projects given, none are registered.

## Pull Existing Skills

If the user already has skills in one agent, pull them into Unity before syncing:

```bash
unity pull --from claude --scope user --fix-names
unity pull --from codex --scope user --fix-names
unity pull --from orion --scope user --fix-names
unity pull --from cursor --scope project --fix-names
unity pull --from opencode --scope project --fix-names
```

You can also pull from a path:

```bash
unity pull --from ~/.claude/skills --scope user
unity pull --from .cursor/skills --scope project
```

To discover new skills across all enabled targets, pull into Unity:

```bash
unity pull --scope all --fix-names
```

## Push

Push Unity's source skills to enabled agent directories:

```bash
unity push --scope all
```

Preview first when touching an existing setup:

```bash
unity push --scope all --dry-run
```

If Unity reports conflicts, do not use `--force` without user approval. Conflicts mean a target skill exists or changed outside Unity.

## Sync

Sync pulls new target skills into Unity first, then pushes Unity's source skills to enabled agent directories:

```bash
unity sync --scope all
```

## Background process

Register projects once:

```bash
unity projects add /path/to/repo
unity projects list
```

Run one background watcher for user scope and all registered projects:

```bash
unity watch --pull
```

Unity stores the active watcher in `~/.agents/watch.json`. Starting another `unity watch` replaces the previous watcher, so agents should prefer launching the desired watcher command directly instead of trying to keep multiple watchers alive.

The running watcher reloads the project registry when `unity projects add` or `unity projects remove` updates the user config.

Keep this process running in the terminal session or arrange for the user to launch it in their preferred process manager.

For one-off debugging in the current repository, use:

```bash
unity watch --scope project --pull --foreground
```

## Excluding an agent

If the user wants a different skills set for an agent, disable that target:

```bash
unity targets disable claude --scope all
```

This stops future syncs but leaves existing mirrored files. To remove only Unity-managed files:

```bash
unity targets disable claude --scope all --prune
```

## Diagnostics

```bash
unity status --verbose
unity doctor --fix
```

`status --verbose` shows managed skills per target. `doctor --fix` creates missing source/config and enabled target directories.
