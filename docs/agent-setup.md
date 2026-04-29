# Agent Setup Guide

This guide is written for coding agents setting up Unity for a user.

## Install

Prefer the package manager already used on the machine:

```bash
npm install -g @nicolasakf/unity
```

or:

```bash
bun add -g @nicolasakf/unity
```

Verify:

```bash
unity --help
```

## Initialize

For a user-wide skills source:

```bash
unity init --scope user
```

For the current repository:

```bash
unity init --scope project
```

For both:

```bash
unity init --scope all
```

`init` creates a user-level `unity-skill` from Unity's README and pushes it to enabled user targets. This helps coding agents understand the user's Unity setup.

## Import existing skills

If the user already has skills in one agent, import them into Unity before syncing:

```bash
unity import --from claude --scope user --fix-names
unity import --from codex --scope user --fix-names
unity import --from orion --scope user --fix-names
unity import --from cursor --scope project --fix-names
unity import --from opencode --scope project --fix-names
```

You can also import from a path:

```bash
unity import --from ~/.claude/skills --scope user
unity import --from .cursor/skills --scope project
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

`unity sync` is still available as the older name for `unity push`.

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
