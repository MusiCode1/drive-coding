# Slice dc-int — drive-coding צורך provider-contract (DRAFT)

> **סטטוס**: 📝 **DRAFT — לא אומת** (נדייק ונחתום אחרי ביצוע P0-reg)
> **Base**: `dev` (drive-coding, אחרי merge P1a+P1b)
> **Complexity**: ~4/10 (calev)
> **depends_on**: `[P0-reg, P1b]` (provider-contract מוכן + P1a/P1b merged ל-dev)

---

## §1 — מטרה
drive-coding מפסיק להגדיר types/adapters מקומית, וצורך אותם מ-`provider-contract` (git-dep).
`core/provider/events.ts` הופך ל-re-export דק; ה-AcpProviderSession המקומי (P1b) מוחלף בזה של ה-package.

## §2 — Scope
| פיצ'ר | כן/לא |
|------|------|
| `package.json`: dep `"provider-contract": "git+https://github.com/MusiCode1/provider-abstraction.git#main"` | ✅ |
| `core/provider/events.ts` → `export * from "provider-contract"` (re-export דק) | ✅ |
| **מחיקת** ה-AcpProviderSession/mapAcpNotification המקומי (P1b) — מגיע מ-package עכשיו | ✅ |
| bootstrap: `const reg = createRegistry()` (acp+claude-code רשומים) | ✅ |
| backend `WsAcpTransport` ממש `AcpTransport` של provider-contract | ✅ |
| frontend cutover | ❌ — P1d |

## §3 — Design highlights
- ה-imports הקיימים (`@drive-coding/core` → ProviderEvent) **לא משתנים** — רק המקור (re-export).
- `WsAcpTransport` (drive-coding) צריך להתאים ל-interface `AcpTransport` של provider-contract.
- ⚠️ git-dep build — pnpm מריץ `prepare` (tsc) של provider-contract; לאמת שה-dist נבנה.

## §4 — Commits (outline)
0. הוסף dep, `pnpm install`, אמת ש-provider-contract נבנה. typecheck.
1. `core/provider/events.ts`→re-export; מחק P1b המקומי; תקן imports. typecheck+vitest.
2. bootstrap registry + חיבור WsAcpTransport.

## §9 — לדיוק אחרי P0-reg בוצע
- ה-API המדויק של `createRegistry`/`ProviderConfig`.
- האם `WsAcpTransport` תואם ל-`AcpTransport` של ה-package (אולי צריך adapter דק).
- git-dep caching/refresh (pnpm) — workflow לעדכון.
