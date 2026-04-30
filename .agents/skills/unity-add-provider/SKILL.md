---
name: unity-add-provider
description: >-
  Guides adding a coding-agent sync target to Unity — either as a built-in
  target in the `@nicolasakf/unity` package or as a user-defined custom target
  (`unity targets add`). Use when implementing a new agent in Unity's codebase,
  or when the user wants to mirror skills to an unsupported agent folder layout.
---

# Unity: add targets

Unity calls each mirror destination a **target**. **Built-in targets** ship in code; **custom targets** live only in config.

## Choose the path

**End users (no fork):** Register paths with `unity targets add <id> --user-path ... --project-path ...`, then enable as usual (`unity targets enable`, `init --targets`, or edit `enabled` in `~/.agents/config.json`). Skip code changes.

**Contributors (@nicolasakf/unity):** Add a **built-in** entry so ids work in `unity init --targets`, `unity pull --from <id>`, and docs examples.

---

## Built-in target checklist

1. **`src/agents.ts`** — Add one key to `BUILT_IN_TARGETS` (same key string as `id`, lowercase slug):

```ts
  myagent: {
    id: "myagent",
    userPath: "~/.myagent/skills",   // home-relative; tilde expands on resolve
    projectPath: ".myagent/skills", // repo-relative under project root
    enabled: { user: true, project: true },
    builtIn: true
  },
```

- **`userPath` / `projectPath`**: Use the paths that agent expects for Skills-style folders (`*/skills/<skill>/SKILL.md`). Confirm against that product's docs.
- **Unity source overlap**: If the resolved target path equals the Unity source (`~/.agents/skills` or `./.agents/skills`), push/pull **skip** that target with "target is the Unity source". Only use that pattern when the agent natively reads the Unity folder (Codex / Orion-style).

2. **Docs** — Add a row to the "Built-in targets" table in `README.md`. If agents commonly run `unity pull --from ...`, align `docs/agent-setup.md` pull examples only when that agent becomes a supported id users will type.

3. **Verification** — `npm test`; `unity doctor` (user/project scope as relevant). Optionally `unity push --scope all --dry-run` and confirm the new id appears when enabled.

4. **`TargetConfig`** — No separate type edit unless new fields are required; defaults come from `src/types.ts` and merging in `normalizeConfig()` (`src/config.ts`). New builtins merge into existing installs on next load: user `enabled.*` preferences are preserved per id where they already existed.

---

## Custom target reminder

```bash
unity targets add pi-code \
  --user-path ~/.pi/skills \
  --project-path .pi/skills
```

Custom entries have `builtIn: false`; they are preserved by `normalizeConfig` and are listed by `unity targets list`.
