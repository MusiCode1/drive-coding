# Commit 2 — post-implementation alignment (320 / 360 / 1280)

## Mobile (320, 360) — `[data-side=start]`

| width | avatarAboveContent | inlineStartDelta | rowContained |
|---|---|---|---|
| 320 | true | 0px | true |
| 360 | true | 0px | true |

No 36px gutter on mobile — avatar stacked above content at inline-start 0.

## Desktop (1280) — `[data-side=start]`

- sameRow: true (avatar + content on one row)
- inlineStartDelta: 36px (= 28px avatar column + 8px gap) — expected desktop rail
- rowContained: true

## Chain after C2

`.bubble-row` → display: **grid**, width: **100%** (replaces no-op align-self).

## סטיות מהתכנון

- None
