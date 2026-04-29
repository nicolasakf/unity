# Configuration

Unity stores config and sync state separately for user and project scopes.

| Scope | Config | State | Source |
| --- | --- | --- | --- |
| User | `~/.agents/config.json` | `~/.agents/state.json` | `~/.agents/skills` |
| Project | `<repo>/.agents/config.json` | `<repo>/.agents/state.json` | `<repo>/.agents/skills` |

`state.json` is a manifest of Unity-managed target files. It is used to avoid overwriting files that were not created by Unity. Codex and Orion read the Unity source path directly (under `.agents/skills`), so those targets are skipped during copy and prune operations.

### Non-interactive init

For CI, scripting, and coding agents that cannot read interactive stdin, pass `--non-interactive` or set `UNITY_INIT_NON_INTERACTIVE=1`.

| Flag / env | Role |
| --- | --- |
| `--non-interactive` | Skip first-run prompts (targets and optional project roots) |
| `--targets <ids>` | Comma-separated built-in provider ids to enable for **user** scope |
| `--projects <paths>` | Comma-separated repository roots (same effect as repeating `unity projects add`) |
| `UNITY_INIT_NON_INTERACTIVE=1` | Force non-interactive mode even when a tty is detected |
| `UNITY_INIT_TARGETS` | Same as `--targets` when no CLI flag |
| `UNITY_INIT_PROJECTS` | Same as `--projects` when no CLI flag |

If `--non-interactive` is used without targets and without `UNITY_INIT_TARGETS`, all built-in targets remain disabled for **user** scope until changed with `unity targets enable`. If `--projects` is omitted and env is unset, no projects are registered.

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
    },
    "orion": {
      "id": "orion",
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
  "orion": {
    "userPath": "~/.agents/skills",
    "projectPath": ".agents/skills"
  },
  "claude": {
    "userPath": "~/.claude/skills",
    "projectPath": ".claude/skills"
  },
  "augment": {
    "userPath": "~/.augment/skills",
    "projectPath": ".augment/skills"
  },
  "cursor": {
    "userPath": "~/.cursor/skills",
    "projectPath": ".cursor/skills"
  },
  "devin": {
    "userPath": "~/.config/devin/skills",
    "projectPath": ".devin/skills"
  },
  "factory": {
    "userPath": "~/.factory/skills",
    "projectPath": ".factory/skills"
  },
  "goose": {
    "userPath": "~/.config/goose/skills",
    "projectPath": ".goose/skills"
  },
  "openclaw": {
    "userPath": "~/.openclaw/skills",
    "projectPath": ".agents/skills"
  },
  "opencode": {
    "userPath": "~/.config/opencode/skills",
    "projectPath": ".opencode/skills"
  },
  "openhands": {
    "userPath": "~/.openhands/skills",
    "projectPath": ".openhands/skills"
  },
  "qwen": {
    "userPath": "~/.qwen/skills",
    "projectPath": ".qwen/skills"
  },
  "windsurf": {
    "userPath": "~/.codeium/windsurf/skills",
    "projectPath": ".windsurf/skills"
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
