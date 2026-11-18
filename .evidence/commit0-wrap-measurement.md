# Commit 0 — wrap measurement (baseline @ f6a3ce4e)

Dev server: `http://localhost:4015/chat?mock=greeting`

## display/width chain (UserBubble root)

Measured via Playwright `getComputedStyle` on bubble root → ancestors.

### 360px viewport

| level | tag | display | width | position | notes |
|---|---|---|---|---|---|
| bubble root | DIV | **flex** | 278.8px | static | `self-start` — parent is block, align-self no-op |
| `.pb-5` | DIV | **block** | 328px | static | ChatBubbles wrapper |
| ListItem | DIV | **block** | 328px | **absolute** | virtua ListItem, width 100% |
| virtua container | DIV | block | 328px | relative | |
| max-w-2xl column | DIV | flex | 328px | static | flex-col |
| chat-scroll | DIV | block | 360px | static | |

### Key finding (confirms §3א)

- ListItem parent of `.pb-5`: `display: block`, `position: absolute`, `width: 100%` of column
- `.pb-5`: `display: block` — **not flex/grid** → `align-self` on bubble root is **no-op**
- Fix path: `width:100%` grid rail (`.bubble-row`), not `self-start`/`self-end`

### Raw JSON

- `.evidence/commit0-baseline-320.json`
- `.evidence/commit0-baseline-360.json`
- `.evidence/commit0-baseline-1280.json`

## סטיות מהתכנון

- None — chain matches brief §3(א). No virtua fork needed.
