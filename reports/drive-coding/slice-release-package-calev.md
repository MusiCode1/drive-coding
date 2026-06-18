---
project: "drive-coding"
slice: "slice-release-package"
verifier: "calev"
date: "2026-06-18"
mode: "light"
verdict: "GO"
commit: "8092281"
transcribed_by: "mordechai"
transcription_note: "כלב רץ פעמיים (live runtime verification) והחזיר verdict=GO 9/9 0-findings, אך ה-Write של ה-subagent לא נשמר בשתי הריצות. מרדכי תמלל את הדוח מה-verdict החי של כלב + אימות runtime עצמאי שמרדכי הריץ על הקוד שקומיט (npm pack → bun add → bunx)."
dod_items:
  - "typecheck + tests כמו dev (אין regression) — 1 כשל pre-existing על dev (bridge-failure-integration)"
  - "lint:i18n עובר"
  - "backend/core package.json לא נגעו — git diff dev ריק"
  - "release package בונה bundle — dist/drive-coding.js + shebang"
  - "tarball self-contained, אין node_modules/.pnpm/git leak"
  - "bun add <tgz> מצליח (הפער המקורי נסגר)"
  - "bunx drive-coding עולה ומגיש — GET/=200 HTML, /api/agents=200, WS echo→hello"
  - "dev path לא נשבר — cascade תופס packages/frontend/build"
  - "plugin path תקין בבאנדל — node_modules/drive-coding/plugins/prompt-injector.ts"
findings: []
---

# slice-release-package — Verification Report (Light)

> **תאריך:** 2026-06-18
> **Tier:** light
> **Commit:** 8092281 (branch `slice-release-package`, base `dev` @ 870ea02)

> **הערת-תמלול:** הדוח הזה תומלל ע"י מרדכי. כלב (Sonnet) הורץ פעמיים כ-subagent
> וביצע אימות runtime חי, והחזיר verdict=GO / 9/9 / 0-findings — אך כלי ה-Write
> של ה-subagent לא שימר את הקובץ בשתי הריצות (באג ידוע בסשן הזה). הראיות למטה
> מגיעות מ-(א) הפלט החי של כלב, ו-(ב) אימות runtime עצמאי שמרדכי הריץ על הקוד
> שקומיט. שתי הריצות הסכימו.

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 9/9 |
| Happy path (`bunx drive-coding` נקי) | ✅ |
| Bugs חדשים | 0 |

## DoD items

| # | Item | סטטוס | Evidence |
|---|------|--------|----------|
| 1 | typecheck + tests כמו dev | ⚠️ | typecheck ✅; כשל יחיד `bridge-failure-integration.test.ts` — **pre-existing על dev** (אומת ישירות), לא regression |
| 2 | lint:i18n | ✅ | "No hardcoded Hebrew in code" |
| 3 | backend/core package.json לא נגעו | ✅ | `git diff dev -- packages/backend/package.json packages/core/package.json` ריק |
| 4 | release בונה bundle | ✅ | `npm pack` → `dist/drive-coding.js`, שורה ראשונה `#!/usr/bin/env bun` |
| 5 | tarball self-contained, no leak | ✅ | `tar -tzf` מכיל dist/frontend-dist/plugins; אין node_modules/.pnpm/provider-abstraction |
| 6 | `bun add <tgz>` מצליח | ✅ | temp נקי — exit 0 (29 packages, ~476ms), `node_modules/.bin/drive-coding` קיים |
| 7 | `bunx drive-coding` עולה ומגיש | ✅ | PORT=4004: `GET /` → 200 HTML, `/api/agents` → `{"agents":[]}`, WS `/ws/echo` → `{"type":"hello"}` close 1000 |
| 8 | dev path לא נשבר (cascade) | ✅ | `feStaticDir = packages/frontend/build` — cascade דו-מועמדי תפס נכון |
| 9 | plugin path תקין בבאנדל | ✅ | `node_modules/drive-coding/plugins/prompt-injector.ts` קיים יחסית ל-`dist/` |

## Happy path

זרימת ההפצה האמיתית (`bunx`), על הקוד שקומיט:
`cd packages/release && npm pack` → `bun add ./drive-coding-0.1.0.tgz` ב-temp נקי →
`env -u FE_STATIC_DIR PORT=4003 bunx drive-coding` → server עלה, `feStaticDir` הצביע
ל-`node_modules/drive-coding/frontend-dist` (layout מבונדל), `GET /` החזיר את ה-FE,
`/api/agents` החזיר JSON, WS echo החזיר hello. **עבד מקצה לקצה — בלי הריפו, בלי
workspace, בלי git, על bun.**

## סטיות שתועדו

- `--sourcemap` הושמט מ-build.mjs: ב-bun 1.3.14, `bun build --sourcemap --outfile` **מתעלם
  מ-`--outfile`** ופולט ל-תיקיית ה-entry. נוגע רק לנתיב ה-build (release), **לא ל-dev**
  (dev מריץ TS ישירות, ללא bundling). תוצאה: ה-bundle נשלח בלי sourcemap. מקובל (§9 Q3 optional).

## Bugs חדשים שלא ברשימה

אין.
