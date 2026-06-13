# Slice redesign-7 — Smart-Scroll + Jump-Down — תוכנית

> **תאריך**: 2026-06-01
> **סטטוס**: הושלם
> **Complexity**: 4/10 (verifier: light)
> **תלות**: depends_on: [redesign-1, redesign-2]
> **base**: branch הקצה הנוכחי של השרשרת (בד"כ slice-redesign-6-modals)

> **למה [1,2] ולא 5**: ה-smart-scroll פועל על אזור-הגלילה שנוצר ב-redesign-2 (AppShell scroll-area).
> הוא לא תלוי בעיצוב הבועות (5). בשרשרת סדרתית ה-base הוא הקצה — בטוח, נוגע באזור-scroll בלבד.

---

## §0 — Pre-flight

> ⚠️ **brief בשרשרת — אומת מול תכנון, לא מול קוד קיים.** ה-scroll-area של AppShell (redesign-2)
> טרם קיים ב-dev. ה-base = ה-branch הקודם בשרשרת (כולל 1+2), **לא dev**. אם 1+2 טרם בוצעו → עצור.
> **חשוב**: בדוק *איפה* redesign-2 שם את ה-scroll-container בפועל (AppShell/ChatScroll) — ה-effect שם.

### Worktree (שרשור)
```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-redesign-7-smart-scroll -b slice-redesign-7-smart-scroll <branch-של-הקודם>
cd .worktrees/slice-redesign-7-smart-scroll
pnpm install && pnpm hooks:install
```

### Run / Browser / OneCLI
- FE: `pnpm --filter @drive-coding/frontend-v2 dev`
- **BE חובה** (צריך תשובות streaming ארוכות כדי לבדוק auto-scroll): OneCLI BE.
- Chrome מקומי. בדיקה: שלח פרומפט עם תשובה ארוכה; גלול למעלה תוך כדי streaming → auto-scroll נעצר +
  כפתור "↓ חדש" מופיע; לחיצה → קופץ לתחתית + ממשיך auto-scroll.
- שם package: `@drive-coding/frontend-v2`.

### Reading list
**must-read**:
- `dev/docs/plans/redesign-vnext.md` §G1 — תיאור הפיצ'ר (v1 כיבה auto-scroll כשגללו למעלה + כפתור ↓).
- `dev/docs/plans/redesign-vnext-mockup.html` — אין mockup ייעודי ל-jump-down (זה "לא במוקאפ" 1162-1163).
  עצב כפתור ↓ עגול צף בתחתית אזור הגלילה (accent, Lucide `ArrowDown`), מעל ה-chat-fade.
- ה-auto-scroll הקיים: **ChatBubbles.svelte** (redesign-2 העביר את ה-scroll ל-AppShell — בדוק איפה
  ה-scroll-container נמצא עכשיו אחרי redesign-2). ה-$effect שנצמד לתחתית (chatEl.scrollTop = scrollHeight).
- `packages/frontend/AGENTS.md` — חוק זהב #4 (effect ב-owner של ה-DOM node — כאן ה-scroll-container).

**reference**: `view-models/agent-session.svelte.ts` — `session.bubbles` (ה-reactive source).

---

## §1 — מטרה

החזרת ה-smart-scroll מ-v1: כל עוד המשתמש בתחתית, ההודעות החדשות נגללות אוטומטית. ברגע שהמשתמש
גולל למעלה (לקרוא הודעה קודמת) — ה-auto-scroll **נעצר** (לא זורק אותו לתחתית), ומופיע כפתור צף
"↓ הודעות חדשות". לחיצה עליו → קפיצה לתחתית + חידוש ה-auto-scroll. זה מתקן את ההתנהגות הנוכחית
(ChatBubbles תמיד נצמד לתחתית — B5 ב-code-review).

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| auto-scroll מותנה (רק כשהמשתמש בתחתית) | ✅ | כאן |
| זיהוי "גלל למעלה" → עצירת auto-scroll | ✅ | כאן |
| כפתור "↓ חדש" צף (מופיע כשלא-בתחתית + יש תוכן חדש) | ✅ | כאן |
| לחיצה → jump לתחתית + חידוש | ✅ | כאן |
| **per-message replay / ⏮⏭** (G2) | ❌ | slice עתידי |
| שינוי ב-bubbles / Speaker | ❌ | — |

> **קו אדום**: רק לוגיקת scroll. לא נוגעים בבועות, ב-Speaker, ב-AgentSession.

---

## §3 — Architecture diagram

```
components/chat/ChatScroll.svelte (או AppShell scroll-area)  ← משתנה: smart-scroll logic
  - ה-$effect של auto-scroll (חוק זהב #4 — חי ב-component שמחזיק bind:this של ה-scroll node)
  - state: isAtBottom (מ-scroll listener), hasNewBelow (תוכן חדש כשלא-בתחתית)
  - כפתור JumpDown (מוצג כש-!isAtBottom && hasNewBelow)
i18n/keys.ts  ← additive ("chat.jumpDown")
```

> **איפה ה-scroll-container אחרי redesign-2?** redesign-2 העביר את ה-scroll ל-AppShell (`chat-scroll`
> wrapper). **בדוק את הקוד בפועל** — ה-smart-scroll logic + ה-$effect חיים ב-component שמחזיק את
> ה-`bind:this` של ה-scroll node (חוק זהב #4). אם זה AppShell — ה-logic שם (או חלץ ל-ChatScroll
> component שעוטף את ה-scroll-area). אל תשים את זה ב-route (חוק זהב #1) ולא ב-VM (זה DOM-node-specific).

> **למה לא VM**: ה-smart-scroll תלוי ב-`scrollTop`/`scrollHeight` של DOM node ספציפי. לפי חוק זהב #4
> הסייג — effects שצריכים DOM node נשארים ב-component. `isAtBottom`/`hasNewBelow` = component-local $state.

---

## §4 — Commits

### Commit 1 — smart-scroll logic + jump button (approach: manual)
**קובץ שמשתנה** (לפי מיקום ה-scroll אחרי redesign-2 — AppShell או ChatScroll):
- `let isAtBottom = $state(true)`, `let hasNewBelow = $state(false)`.
- scroll listener (`onscroll`): `isAtBottom = scrollHeight - scrollTop - clientHeight < THRESHOLD` (~50px).
  כש-`isAtBottom` → `hasNewBelow = false`.
- ה-$effect הקיים (auto-scroll ל-bubbles חדשים): רק אם `isAtBottom` → scrollToBottom. אחרת →
  `hasNewBelow = true` (יש תוכן חדש מתחת).
- כפתור JumpDown (Lucide `ArrowDown`, accent, עגול, צף `absolute bottom`): מוצג `{#if !isAtBottom && hasNewBelow}`.
  onClick → scrollToBottom + `isAtBottom = true` + `hasNewBelow = false`.
- **i18n**: `t("chat.jumpDown")` (aria-label/title).
**Verification**: `typecheck/build/test/lint:i18n` + ידני:
  - תשובה ארוכה streaming → נצמד לתחתית (כש-בתחתית).
  - גלול למעלה תוך streaming → לא נזרק; כפתור ↓ מופיע.
  - לחץ ↓ → קופץ לתחתית + ממשיך auto-scroll.

---

## §5 — DoD

| בדיקה | איך |
|---|---|
| typecheck/build/test/i18n נקיים | פקודות |
| auto-scroll בתחתית | המשתמש בתחתית + הודעה חדשה → נגלל אוטומטית |
| עצירה בגלילה-למעלה | גלל למעלה תוך streaming → **לא** נזרק לתחתית |
| כפתור ↓ מופיע | כש-!בתחתית + תוכן חדש → כפתור צף מוצג |
| jump עובד | לחיצה → קפיצה לתחתית + חידוש auto-scroll + כפתור נעלם |
| אין רגרסיה | בועות/Speaker/הקראה לא הושפעו |
| effect ב-owner | ה-$effect ב-component שמחזיק bind:this (לא route, לא VM) |

---

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| THRESHOLD לא מדויק (jitter) | scroll math | סף ~50px; בדוק שגלילה קלה לא מפעילה false. |
| auto-scroll fights user | B5 code-review | הכלל: auto-scroll **רק** כש-isAtBottom. אחרת לעולם לא לכפות scrollTop. |
| effect מיקום (route/VM) | חוק זהב #4 | ה-logic ב-component שמחזיק ה-scroll node. **בדוק איפה redesign-2 שם אותו.** |
| reactivity: bubbles vs scroll | learnings | ה-$effect קורא `session.bubbles.length` + segment lengths (כמו ChatBubbles הקיים) כדי לרוץ על תוכן חדש. |
| Hardcoded Hebrew | hook | t("chat.jumpDown"). |

---

## §7 — Escalation triggers
- אחרי redesign-2, ה-scroll-container במקום לא צפוי שמקשה על מיקום ה-effect → עצור ושאל.
- צריך לשנות bubbles/Speaker/AgentSession כדי לזהות "תוכן חדש" → עצור (scrollHeight אמור להספיק).

## §8 — Complexity score
**4/10 → light.** commit 1, שכבה: component אחד (scroll logic), אין API חיצוני, אין refactor state,
scroll math + reactive effect (+2). ≈4. בדיקה runtime ויזואלית פשוטה. light בבירור.

## §9 — שאלות פתוחות
| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | ה-logic ב-AppShell או ChatScroll נפרד? | איפה ש-redesign-2 שם את ה-scroll node; חלץ ChatScroll אם AppShell גדל | ❌ |
| 2 | THRESHOLD ל-isAtBottom | ~50px | ❌ |
| 3 | "תוכן חדש" — כל bubble או רק כשלא-בתחתית? | hasNewBelow=true רק כשמגיע תוכן ו-!isAtBottom | ❌ |
