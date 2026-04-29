# Configuration

Unity stores config and sync state separately for user and project scopes.

| Scope | Config | State | Source |
| --- | --- | --- | --- |
| User | `~/.agents/config.json` | `~/.agents/state.json` | `~/.agents/skills` |
| Project | `<repo>/.agents/config.json` | `<repo>/.agents/state.json` | `<repo>/.agents/skills` |

`state.json` is a manifest of Unity-managed target files. It is used to avoid overwriting files that were not created by Unity. Codex reads the Unity source path directly, so the Codex target is skipped during copy and prune operations.

`sync.lock` is created while Unity mutates a scope. If another Unity process sees the lock, it stops instead of racing the active operation. Locks older than 30 minutes are treated as stale and replaced.

`watch.json` is stored in the user config directory and records the active Unity watcher PID and flags. Starting a new watcher terminates the previous registered watcher before claiming the file.

## Config shape

```json
{
  "version": 1,
  "targets": {
    "codex": {
      "id": "codex",
      "userPath": "~/.agents/skills",
      "projectPath": ".agents/skills",
      "enabled": {
        "user": true,
        "project": true
      },
      "builtIn": true
    }
  },
  "projects": []
}
```

Each target has:

| Field | Description |
| --- | --- |
| `id` | Stable target identifier. |
| `userPath` | User-level skills directory. `~` expands to the home directory. |
| `projectPath` | Project-level skills directory relative to the repository root unless absolute. |
| `enabled.user` | Whether user-scope sync writes to this target. |
| `enabled.project` | Whether project-scope sync writes to this target. |
| `builtIn` | Whether Unity created the target by default. |

The user config also has a top-level `projects` array. `unity projects add <path>` stores project roots there, and `unity watch` uses that registry for its global watcher.

## Built-in targets

```json
{
  "codex": {
    "userPath": "~/.agents/skills",
    "projectPath": ".agents/skills"
  },
  "claude": {
    "userPath": "~/.claude/skills",
    "projectPath": ".claude/skills"
  },
  "cursor": {
    "userPath": "~/.cursor/skills",
    "projectPath": ".cursor/skills"
  },
  "opencode": {
    "userPath": "~/.config/opencode/skills",
    "projectPath": ".opencode/skills"
  }
}
```

## Custom targets

```bash
unity targets add pi-code \
  --user-path ~/.pi-code/skills \
  --project-path .pi-code/skills
```

The command adds the custom target to both user and project configs.

## Disable and prune

Disable an agent without deleting files:

```bash
unity targets disable claude --scope all
```

Disable and remove Unity-managed files:

```bash
unity targets disable claude --scope all --prune
```

Pruning only removes skills listed in Unity's manifest. It skips target skills that changed outside Unity.
