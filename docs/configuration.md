# Configuration

Unity stores config and sync state separately for user and project scopes.

| Scope | Config | State | Source |
| --- | --- | --- | --- |
| User | `~/.agent/config.json` | `~/.agent/state.json` | `~/.agent/skills` |
| Project | `<repo>/.agent/config.json` | `<repo>/.agent/state.json` | `<repo>/.agent/skills` |

`state.json` is a manifest of Unity-managed target files. It is used to avoid overwriting files that were not created by Unity.

`sync.lock` is created while Unity mutates a scope. If another Unity process sees the lock, it stops instead of racing the active operation. Locks older than 30 minutes are treated as stale and replaced.

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
  }
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
