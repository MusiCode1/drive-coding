# Agent documentation map

This directory holds depth documentation for agents working with drive-coding.

- **`index.json`** is **generated** — run `bun run docs:index` after you change front matter.
- **Other `*.md` files** are **hand-edited**; each carries YAML front matter checked by
  `scripts/lint-agent-docs.mjs`.

**Agents:** run `bun run docs:list` for every document's path, summary, and `read_when`
triggers, then open the files you need.
