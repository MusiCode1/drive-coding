# Slice input-autogrow — textarea שגדל עם הטקסט עד תקרה — תוכנית

> **תאריך**: 2026-06-25
> **סטטוס**: הושלם (commit 77e939f, branch slice-input-autogrow)
> **Complexity**: 2/10 (verifier: light)
> **תלות (depends_on)**: `[]` — נוגע רק ב-`TypeArea.svelte` (קומפוננטה עצמאית). enter-toggle כבר מוזג ל-dev (ה-handler הקיים), ואין חפיפה עם שרשרת latex/chat-render-polish.
> **Base**: `dev` HEAD (tip בעת הכתיבה `4a28952`; ה-delta מ-tip קודם הוא docs-only/ancestor — גזור מ-`dev` עדכני).

---

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/slice-input-autogrow -b slice-input-autogrow dev
cd .worktrees/slice-input-autogrow
pnpm install && pnpm hooks:install
```

### Run
- **FE בלבד מספיק** (אין נגיעת BE/proxy):
  `pnpm --filter @drive-coding/frontend dev` (port: OS-assigned, Vite מדפיס)
- בדיקות:
  ```bash
  pnpm --filter @drive-coding/frontend typecheck
  pnpm --filter @drive-coding/frontend build      # adapter-static — מוודא שה-prod build לא נשבר
  pnpm lint:i18n
  ```

### Browser
- אין DISPLAY במכונה → linux-gui Chrome :9222.
  `playwright-cli -s=vacp attach --cdp=http://localhost:9222` (תמיד `-s=vacp`).
- בדיקה בלי BE: `/chat?mock=greeting` (reload מלא, לא ניווט SPA) — מספיק כדי לבדוק את ה-textarea.

### OneCLI agent
- **לא דרוש** — אין proxy/TTS בסבב הזה.

### Reading list
**must-read לפני**:
- `packages/frontend/AGENTS.md` — חמשת חוקי הזהב (במיוחד #4 effect-ownership: ה-`$effect` חי בקומפוננטה שמחזיקה את ה-textarea).
- `packages/frontend/src/lib/components/chat/TypeArea.svelte` — **כל הקובץ** (68 שורות). זה הקובץ היחיד שמשתנה.

**reference בזמן עבודה**:
- `packages/frontend/src/app.css` — אם צריך משתנה/utility למחזה (אבל עדיף inline style, ר' §4).

---

## §1 — מטרה

כשהמשתמש מקליד הודעה רב-שורתית (במיוחד הכתבה קולית / נייד), ה-textarea **גדל אוטומטית עם הטקסט** במקום להישאר 2 שורות עם scroll פנימי — כך רואים את כל מה שכתוב. הגדילה נעצרת בתקרה (~6 שורות), ומשם נכנס scroll פנימי כדי לא להשתלט על המסך. אחרי שליחה ה-textarea מתכווץ חזרה לגובה ההתחלתי.

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| auto-grow של ה-textarea עד MAX שורות | ✅ | הסבב הזה |
| כיווץ חזרה לגובה בסיס אחרי שליחה / מחיקת טקסט | ✅ | הסבב הזה |
| scroll פנימי מעל התקרה | ✅ | הסבב הזה |
| גובה-תקרה כהגדרה ב-Settings | ❌ | backlog (קבוע hardcoded בינתיים, ר' §9 Q2) |
| שינוי לוגיקת onkeydown / enter-toggle | ❌ | enter-toggle (כבר מוזג) — **לא לגעת** |
| הדבקת תמונות / multimodal | ❌ | slice image-paste (תלוי-חוזה) |
| פקודות Slash | ❌ | slice slash-commands (תלוי-חוזה) |

## §3 — Architecture diagram

```
┌─ routes ──────────────────────────────────────────────┐
│  (ללא שינוי)                                            │
├─ components ──────────────────────────────────────────┤
│  chat/TypeArea.svelte   ← bind:this + $effect autosize  │
│                            + max-height/overflow ב-style │
│                            + form items-stretch→items-end │
├─ view-models / engines / adapters ────────────────────┤
│  (ללא שינוי)                                            │
└────────────────────────────────────────────────────────┘
אין שינוי i18n / core / BE.
```

## §4 — Commits

### Commit 1 — auto-grow ב-TypeArea (approach: manual — browser smoke)

**קובץ יחיד שמשתנה**: `packages/frontend/src/lib/components/chat/TypeArea.svelte`

**(א) script — הוסף ref + קבוע + effect** (אחרי `let promptText = $state("")`, L17):
```ts
let taEl = $state<HTMLTextAreaElement>()
const MAX_ROWS = 6

// גדל עם התוכן עד תקרה; ה-effect רץ גם בהקלדה וגם בכיווץ פרוגרמטי (promptText="")
$effect(() => {
  promptText // dependency — re-run on every value change
  const el = taEl
  if (!el) return
  el.style.height = "auto"            // קודם מאפסים כדי שה-scrollHeight ישקף את התוכן הנוכחי
  el.style.height = `${el.scrollHeight}px`
})
```
> **למה `$effect` ולא `oninput`**: מחיקה פרוגרמטית (`promptText = ""` ב-`onSubmit`) **לא** מפעילה אירוע `input`, אז handler על input לא היה מכווץ אחרי שליחה. effect שתלוי ב-`promptText` מכסה את שני המקרים.

**(ב) `<form>` element** (L32-35) — שינוי יחיד:
- שנה `class="flex gap-2 items-stretch w-full"` → `class="flex gap-2 items-end w-full"`.
  > **למה (finding אביגיל #1)**: `items-stretch` מותח כל flex-child לגובה הגבוה ביותר. כשה-textarea גדל ל-MAX_ROWS, כפתור ה-Send יימתח איתו לכפתור-ענק. `items-end` מיישר את הכפתור ל**תחתית** — הוא שומר על גובהו הטבעי ויושב בקו התחתית של ה-textarea הגדל (הדפוס הסטנדרטי ל-chat composer שגדל כלפי מעלה).

**(ג) textarea element** (L36-56) — שלושה שינויים נקודתיים, השאר ללא נגיעה:
- הוסף `bind:this={taEl}`.
- שנה `rows={2}` → `rows={1}` (גובה בסיס מינימלי = שורה אחת; גדל מיד עם תוכן). *(אם מעדיפים לשמר את המראה הנוכחי של 2 שורות — ר' §9 Q1.)*
- הוסף ל-inline `style` הקיים: `max-height` ל-MAX_ROWS ו-`overflow-y:auto`:
  ```svelte
  style="background:var(--bg-card); border-color:var(--border); color:var(--fg); max-height:calc({MAX_ROWS} * 1.5em + 1.25rem); overflow-y:auto"
  ```
  > `1.5em` ≈ line-height של `text-sm`; `1.25rem` ≈ ה-padding האנכי (`py-2.5` = 0.625rem ×2). ה-`max-height` חוסם את הגובה ש-ה-effect מציב; `overflow-y:auto` נותן scroll מעל התקרה.

**אסור לשנות**: את ה-`onkeydown` (L43-55, שייך ל-enter-toggle), את ה-`onSubmit`, את הכפתור, את שאר ה-class-ים (`resize-none` **נשאר** — אנחנו שולטים בגובה).

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck   # 0 errors
pnpm --filter @drive-coding/frontend build        # prod build נקי (adapter-static)
pnpm lint:i18n                                     # אין מחרוזות חדשות → אמור לעבור ללא שינוי
# browser (linux-gui :9222), /chat?mock=greeting:
#  1. textarea ריק = גובה שורה אחת
#  2. הקלד 3 שורות (Shift+Enter) → גדל ל-3 שורות, בלי scroll
#  3. הקלד >6 שורות → נעצר ב-~6, scroll פנימי מופיע
#  4. שלח (כפתור) → מתכווץ חזרה לגובה בסיס
#  5. אין "ריצוד" של scrollbar בן 1px במצב יציב
```

## §5 — DoD

| בדיקה | איך |
|---|---|
| textarea ריק = גובה בסיס (שורה אחת) | ידני ב-/chat |
| גדל עם הטקסט שורה-שורה עד MAX_ROWS | ידני (Shift+Enter ×N) |
| מעל MAX_ROWS — נעצר + scroll פנימי | ידני |
| **כפתור Send שומר על גובהו הטבעי כשה-textarea גדל** (לא מתמתח ל-6 שורות) | ידני — הקלד 6 שורות, ודא שהכפתור נשאר בגובה רגיל ויושב למטה |
| אחרי שליחה — מתכווץ חזרה לבסיס | ידני |
| הדבקת בלוק טקסט ארוך → גדל מיד (לא רק בהקלדה) | ידני (paste) |
| אין scrollbar-jitter קבוע במצב יציב | ידני (ר' §6) |
| `onkeydown`/enter-toggle ללא שינוי התנהגות | ידני: Enter עדיין שולח (ברירת מחדל), Shift+Enter שורה |
| typecheck + build + lint:i18n נקיים | הפקודות ב-§4 |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| **כפתור Send נמתח עם ה-textarea** — ה-`<form>` היה `items-stretch` | אביגיל r1 finding #1 | שונה ל-`items-end` ב-§4 (ב); ה-DoD בודק במפורש את גובה הכפתור ב-6 שורות |
| `box-sizing:border-box` + border 1px → scrollHeight לא כולל border → ייתכן scrollbar קבוע של ~1-2px | דפוס ידוע ב-auto-resize textarea | אם מופיע ריצוד יציב: הוסף ל-effect היסט border — `el.style.height = el.scrollHeight + el.offsetHeight - el.clientHeight + "px"` (אחרי איפוס ל-auto). **אם לא מופיע — להשאיר פשוט.** מסומן כ-escalation אם לא נפתר בקלות |
| Svelte 5 effect ownership | learnings | ה-`$effect` בתוך הקומפוננטה שמחזיקה את ה-textarea (חוק זהב #4) — תקין |
| מחיקה פרוגרמטית לא מכווצת | תכנון | פתור בעיצוב: effect תלוי ב-`promptText`, לא ב-input event (ר' הערה §4) |
| `1.5em`/`1.25rem` ב-max-height לא תואמים את ה-font בפועל → MAX לא בדיוק 6 שורות | — | לא קריטי — "בערך 6" מספיק; אם רחוק מאוד, לכייל את הקבועים מול הדפדפן. לא חוסם |
| מחרוזת עברית קשיחה | learnings (pre-commit) | אין מחרוזות חדשות בסבב הזה |

## §7 — Escalation triggers

עצור ושאל את מרדכי (parent task) אם:
- ה-`TypeArea.svelte` בבסיס **לא** מכיל את ה-`onkeydown` עם `settings.enterToSend` → enter-toggle לא מוזג, הבסיס שגוי.
- ה-scrollbar-jitter (§6) **לא** נפתר עם היסט ה-border → ייתכן שצריך גישה אחרת (rows-counting), החלטת-עיצוב.
- ה-prod `build` נשבר באופן שקשור ל-`bind:this`/`$effect` (לא אמור — דפוס סטנדרטי).

## §8 — Complexity score

- commits: 1 (נמוך)
- שכבות חדשות: 0 (קומפוננטה קיימת)
- APIs חיצוניים: 0
- streaming/async: לא
- refactor state model: לא
- שינוי protocol BE↔FE: לא

**Score ≈ 2/10 → verifier `calev` mode: light.** אין phase רגיש.

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל מוצעת | חוסם? |
|---|---|---|---|
| 1 | גובה בסיס — שורה אחת (`rows={1}`) או לשמר 2 שורות נוכחיות (`rows={2}`)? | שורה אחת — נקי יותר, גדל מיד | ❌ |
| 2 | `MAX_ROWS` — 6 שורות. סביר? | 6 (≈ חצי מסך נייד) | ❌ |
| 3 | האם להפוך את התקרה להגדרה ב-Settings? | לא בסבב הזה — קבוע hardcoded, אפשר slice עתידי | ❌ |
| 4 | טרייד-אוף `items-end` (אביגיל r2 #3): במצב **שורה-אחת** הכפתור מיושר-לתחתית ונשאר רווח ~6px בקצה-העליון שלו (textarea ~42px > כפתור ~36px). **הכרעה: מקובל** — יישור-לתחתית הוא דפוס ה-composer הסטנדרטי (ChatGPT/Claude), והוא הנכון כשה-textarea גדל כלפי מעלה. החלופה (`items-stretch`) מחזירה את רגרסיית כפתור-הענק. אם בכל זאת מפריע ה-6px — אפשר `min-h` תואם על הכפתור, אבל **לא בסבב הזה**. | items-end (מיושר-תחתית) | ❌ |
