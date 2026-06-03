---
project: "voice-acp"
slice: "slice-fix-switch-session-warm"
verifier: "calev"
date: "2026-06-03"
mode: "light"
verdict: "GO"
dod_items:
  - "typecheck נקי (פרט ל-narrate.test.ts pre-existing)"
  - "build נקי"
  - "כל הטסטים הקיימים עוברים (אין רגרסיה)"
  - "lint:i18n נקי"
  - "switchSession קיים ב-AgentSession עם החתימה הנכונה"
  - "switchSession כש-#client===null קורא loadSession (fallback)"
  - "switchSession כש-status!==connected זורק"
  - "switchSession לא קורא #cleanup ב-catch"
  - "selectSession ב-panel קורא switchSession (לא detach+loadSession)"
  - "runtime: החלפת סשן ללא WS closed ובלי createAndSpawn/deleteAndKill"
  - "cross-rename: סשן מנתיב ישן נטען בהצלחה"
  - "רגרסיה: התחברות ראשונה מדף-חיבור עדיין עובדת"
spot_check: "שני switches ב-UI דרך tunnel — history נטען, agent count=1 לאורך כל הזמן"
findings:
  - id: 1
    severity: "minor"
    category: "unique"
    summary: "409 על notifySessionAttached בכל warm switch — BE registry לא מתעדכן לסשן החדש"
    source_brief: "§4.א שורת notifySessionAttached + catch(()=>{})"
    source_code: "agent-session.svelte.ts:325-326 + backend/http-agents.ts:117-118"
    cost_estimate: "15min"
---

# slice-fix-switch-session-warm — Verification Report (Light)

> **תאריך:** 2026-06-03
> **Tier:** light
> **Commit:** 8d47095 (tip), fb7c2d7 (implementation)

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 12/12 |
| Happy path עובד | ✅ |
| Bugs חדשים | 0 blockers |
| ממצאים | 1 minor (409 registry staleness) |

## DoD items

| # | Item | סטטוס | Evidence |
|---|------|--------|----------|
| 1 | typecheck נקי (פרט narrate.test.ts) | ✅ | `svelte-check` — 2 errors רק ב-narrate.test.ts, pre-existing |
| 2 | build נקי | ✅ | `pnpm --filter @drive-coding/frontend-v2 build` — ✓ built in 16.08s |
| 3 | כל הטסטים עוברים | ✅ | 599 pass, 1 fail (bridge-manager.idle test4 — pre-existing flaky, תועד ב-handoff) |
| 4 | lint:i18n נקי | ✅ | `✓ No hardcoded Hebrew in code.` |
| 5 | `switchSession` קיים עם החתימה הנכונה | ✅ | agent-session.svelte.ts:288-336 — חתימה זהה לחלוטין ל-brief §4.א |
| 6 | `#client===null` → `loadSession` | ✅ | שורה 294-295: `if (this.#client === null) { return this.loadSession(input) }` |
| 7 | `status!=="connected"` → throws | ✅ | שורות 297-300: `throw new Error(\`cannot switchSession in status ${this.status}\`)` |
| 8 | לא `#cleanup` ב-catch | ✅ | catch block שורות 330-335 — רק `this.error` + `this.#setStatus("error")`, ללא `#cleanup()`. הערת "// לא #cleanup" מפורשת |
| 9 | `selectSession` קורא `switchSession` | ✅ | SessionOptionsPanel.svelte:108-116 — `session.switchSession(...)`, ללא `detach` |
| 10 | runtime: ללא WS closed, ללא createAndSpawn/deleteAndKill | ✅ | agent count=1 לפני ואחרי שני switches (id:`b5a26891` לא השתנה, createdAt זהה). console log: רק 2 שגיאות 409 (ראה finding #1), אפס "WS closed" |
| 11 | cross-rename: סשן מנתיב ישן נטען | ✅ | בחרתי session "דוחות נוכחות חודשים" מ-`/home/user/projects/salary-reports` — header התעדכן ל-`salary-reports`, history bubbles הוצגו, status=Connected |
| 12 | רגרסיה: חיבור ראשון מדף-חיבור | ✅ | Connect → `/chat` תוך ~4s, `Connected` ב-UI |

## Happy path

חיבור לסשן `/home/user` (חדש, ריק) → פתיחת panel → בחירת "New session 06:06" → ה-UI עבר ל-`/chat`, status=Connected, history=ריק. ‏agent count נשאר 1 (אין spawn). החלפה שנייה ל-`salary-reports` session → history עם bubbles נטענו, header התעדכן. שני מעברים — ללא "WS closed", ללא הבהוב.

✅ עבד

## Bugs חדשים שלא ברשימה

### 🟡 Finding #1 — 409 על `notifySessionAttached` בכל warm switch (minor, לא blocker)

**תיאור:** כל קריאה ל-`switchSession` מסתיימת עם 409 מ-BE על `/api/agents/:id/session-attached`. ה-BE מגן (MED-9): אם agent כבר "ready" עם `acpSessionId` שונה → 409 `"agent already attached to a different session"`. בדיוק זה קורה בכל warm switch: ה-FE מחליף סשן (ACP loadSession על אותו WS), אחר כך קורא `notifySessionAttached(agentId, newSessionId)` — אבל ה-BE מסרב כי הוא כבר ready.

**השפעה:** BE registry (`acpSessionId`) נשאר עם ה-sessionId הישן. ה-FE עצמו `switchSession` מצליח (ACP loadSession עבד, bubbles נטענו, status=connected). המשתמש רואה חוויה תקינה. ה-409 נבלע ב-`.catch(()=>{})`.

**סיכון עתידי:** אם ה-BE ישתמש ב-`acpSessionId` ל-reconnect/recovery, הוא ישחזר לסשן הישן במקום לסשן הנוכחי.

**הערה:** זה **לא** bug שנוצר ב-slice זה — ה-guard MED-9 קיים מ-slice קודם. ה-slice הזה חשף את ה-collision. הפתרון הנכון: BE צריך לאפשר update ל-sessionId כשמדובר באותו agent (idempotent replace), או שה-FE יעדכן את ה-registry בנפרד לפני/אחרי ה-switch.

**עלות תיקון:** ~15 דקות ב-http-agents.ts (הסרת guard MED-9 למקרה של same-agent update / שינוי logic לאפשר update).
