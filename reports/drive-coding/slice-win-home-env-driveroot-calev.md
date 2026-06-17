---
project: "drive-coding"
slice: "win-home-env-driveroot"
verifier: "calev"
date: "2026-06-16"
mode: "light"
verdict: "GO"
dod_items:
  - "typecheck passes — 0 errors"
  - "29 backend tests green (getHomeDir x2 + normalizeRealpath x3 + 24 others)"
  - "pnpm test regressions: frontend+lint pre-existing only (svelte-kit not synced in worktree)"
  - "drive-root browse D:\\ returns entries — not 500"
  - "getHomeDir env-first: homeDir=D:\\Users\\User from /api/options"
  - "navigation path D:\\Users\\User → D:\\Users → D:\\ → D:\\UserProjects all OK"
  - "lint:i18n pre-existing failure (shell script blocked on Windows)"
spot_check: "curl http://localhost:4010/api/fs/browse?path=D:\\ → 23 entries including UserProjects"
findings: []
---

# slice-win-home-env-driveroot — Verification Report (Light)

> **תאריך:** 2026-06-16
> **Tier:** light
> **Commit:** 53e8fbb (normalizeRealpath), 618a05b (getHomeDir)

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 6/6 (lint:i18n pre-existing) |
| Happy path עובד | YES |
| Bugs חדשים | 0 |

## DoD items

| # | Item | סטטוס | Evidence |
|---|------|--------|----------|
| 1 | typecheck | OK | `tsc --noEmit` — 0 errors |
| 2 | 29 tests green | OK | `vitest run http-options.test.ts http-history.test.ts` → 29/29 passed |
| 3 | pnpm test — no new regressions | OK | 23 FAIL = frontend (svelte-kit not synced in worktree) + lint-no-hebrew — all pre-existing, no backend failures |
| 4 | getHomeDir env-first (stubEnv tests) | OK | `getHomeDir > prefers HOME env` + `falls back to USERPROFILE` both green |
| 5 | fs/browse drive-root D:\\ → entries | OK | `curl .../browse?path=D%3A%5C` → `{"path":"D:\\\\","entries":[...23 items...]}` |
| 6 | regression: browse within home | OK | `D:\\Users\\User` → 120+ entries; `D:\\Users` → 4 entries; `D:\\UserProjects` → 60+ entries |
| 6 | lint:i18n | PRE-EXISTING | `./scripts/lint-no-hebrew-in-code.sh` blocked on Windows (same failure as base branch) |

## Happy path

Navigation flow — D:\\Users\\User → D:\\Users → D:\\ → D:\\UserProjects:

- `D:\\Users\\User` → 200, entries include .claude, AppData, projects etc.
- `D:\\Users` → 200, entries: CodeShark200, User, vendor, desktop.ini
- `D:\\` → 200, entries include UserProjects, Users, Backup, mnt etc. (23 items)
- `D:\\UserProjects` → 200, entries include AI, Android, Financial etc. (60+ items)

OK — all four hops returned entries, no 500s.

## normalizeRealpath unit tests

```
normalizeRealpath > adds backslash to bare drive-root (bun async realpath returns 'D:')  ✓
normalizeRealpath > leaves drive paths with subdirs unchanged                              ✓
normalizeRealpath > leaves Unix paths unchanged                                            ✓
```

## getHomeDir runtime

`GET /api/options` → `"homeDir":"D:\\Users\\User"` — resolved from USERPROFILE/os.homedir(), not hardcoded.

## /api/options homeDir

Live check on port 4010: `homeDir` field = `D:\\Users\\User` — absolute Windows path, valid.

## Bugs חדשים שלא ברשימה

אין.

## הערת lint:i18n

`pnpm lint:i18n` נכשל כי הסקריפט `./scripts/lint-no-hebrew-in-code.sh` לא ניתן להרצה ישירות ב-Windows PowerShell. זו אותה כשלה pre-existing מה-base branch ומ-pnpm test (lint-no-hebrew-in-code.test.mjs). אינה קשורה לשינויים של ה-slice.
