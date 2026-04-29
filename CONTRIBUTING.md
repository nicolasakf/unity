# Contributing

Thanks for helping improve Unity.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

Use focused pull requests. Changes that affect sync safety should include tests that cover conflicts and manifest ownership.

## Design principles

- Unity source directories are authoritative.
- Agent target directories may contain user-owned files; never overwrite those silently.
- Prefer copy-based sync over symlinks for cross-agent compatibility.
- Keep the CLI useful to both humans and coding agents.
