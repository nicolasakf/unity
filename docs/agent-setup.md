# Agent Setup Guide

This guide is written for coding agents setting up Unity for a user.

## Install

Prefer the package manager already used on the machine:

```bash
npm install -g @agent-skills/unity
```

or:

```bash
bun add -g @agent-skills/unity
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

## Import existing skills

If the user already has skills in one agent, import them into Unity before syncing:

```bash
unity import --from claude --scope user --fix-names
unity import --from codex --scope user --fix-names
unity import --from cursor --scope project --fix-names
unity import --from opencode --scope project --fix-names
```

You can also import from a path:

```bash
unity import --from ~/.claude/skills --scope user
unity import --from .cursor/skills --scope project
```

## Sync

Run a one-time sync:

```bash
unity sync --scope all
```

Preview first when touching an existing setup:

```bash
unity sync --scope all --dry-run
```

If Unity reports conflicts, do not use `--force` without user approval. Conflicts mean a target skill exists or changed outside Unity.

## Background process

Unity v1 uses a foreground watcher:

```bash
unity watch --scope all
```

Keep this process running in the terminal session or arrange for the user to launch it in their preferred process manager.

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
