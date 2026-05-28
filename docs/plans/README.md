# Plans — איך כותבים תוכנית לסבב פיתוח

> ‏**תכלית**: ‏מסגרת אחידה לכתיבת מסמכי תכנון (briefs) ‏לסבבים שניתנים לסוכן executor חדש.
> ‏**מתייחס לסוכנים**: ‏Sonnet (executor), ‏עם Opus (Tama) ‏כplanner.
> ‏**משלים את**: ‏ה-`tdd` skill (~/.agents/skills/tdd/) ‏שמכסה את workflow ה-TDD עצמו.

---

## 1. מתי TDD ומתי לא — decision tree

‏השאלה הראשונה לפני כתיבת brief: ‏האם הסבב הזה מתאים ל-TDD?

### ✅ TDD מתאים מצוין כש:

- ‏הלוגיקה ב-`packages/core/` (פונקציות טהורות, ‏אין I/O)
- ‏באג שניתן לשחזר כtest case
- ‏Refactor של פונקציה עם API קיים ויציב
- ‏Parsers, ‏transformers, ‏validators, ‏state machines pure
- ‏אלגוריתמים (sentence splitter, ‏cache key, ‏diff)

**‏סימן מובהק**: ‏אתה יודע מראש מה ה-input ומה ה-expected output.

### ❌ TDD לא מתאים כש:

- ‏UI integration — ‏רוב הקוד הוא composition של components + ‏events. ‏בדיקה ידנית בdrowser היא ה-feedback loop האמיתי.
- ‏Streaming/audio (MediaSource, ‏WebAudio, ‏MediaRecorder) — ‏API-ים שדורשים real browser, ‏לא JSDOM.
- ‏Refactor של state model — ‏לא יודע איך תיראה ה-shape הסופית עד שאתה בונה
- ‏אינטגרציה מול שירות חיצוני (LLM, ‏TTS, ‏STT) — ‏ה-test היחיד שמשמעותי הוא real call
- ‏Glue code: ‏event handlers, ‏Context wiring, ‏layout composition
- ‏הוספת engine/adapter חדש: ‏ה-shape של ה-API מתגלה בזמן השימוש בו ב-VM

**‏סימן מובהק**: ‏אם תכתוב test ראשון, ‏אתה תכתוב אותו לפי דמיון, ‏לא לפי behavior. ‏זה bad test לפי ה-`tdd` skill ("‏tests insensitive to real changes").

### 🟡 ה-mix השכיח (רוב ה-slices האמיתיים)

‏סבב טיפוסי מכיל:
- ‏ליבה טהורה ב-core → ‏**TDD** (commit 0 בד"כ)
- ‏Glue ב-VM/engine/adapter → ‏**non-TDD** עם manual verification
- ‏UI ב-route/component → ‏**non-TDD** עם browser smoke test

‏ה-brief צריך **לסמן לכל commit איזה approach**.

---

## 2. מבנה תוכנית non-TDD — סעיפים חובה

‏סדר הסעיפים מובנה — ‏סוכן חדש קורא מלמעלה ויכול להתחיל אחרי §0 בלי לדפדף.

### §0 — Pre-flight (חובה ראשונה)

‏סוכן חדש מגיע עם 0 context. ‏הסעיף הזה חוסך לו 10K tokens של חיפוש:

- ‏**Worktree**: ‏איפה ליצור (`.worktrees/<name>`), ‏מאיזה branch לגזור (`dev`), ‏ה-`pnpm install && pnpm hooks:install` אחרי
- ‏**איך להריץ**: ‏פקודה מדויקת ל-BE, ‏ל-FE, ‏ל-tests. ‏מי על איזה port
- ‏**Tunnel**: ‏אם יש URL ציבורי (pico/cloudflared) — ‏command + ‏URL הצפוי
- ‏**Browser**: ‏מי הbrowser הנכון לבדיקה (Chrome רגיל? ‏linux-gui? ‏phone?)
- ‏**OneCLI agent**: ‏שם agent + ‏מתי משתמשים בו (`onecli run --agent X -- ...`)
- ‏**Reading list עם priority**:
  - ‏**must-read לפני**: ‏המסמכים שבלעדיהם הסוכן יחליט החלטות שגויות
  - ‏**reference בזמן עבודה**: ‏מסמכים לפתוח לפי הצורך

### §1 — מטרה (1 פסקה)

‏פסקה אחת. ‏מה תהיה החוויה אחרי שהsbb הזה הושלם — ‏מנקודת מבט המשתמש.

### §2 — Scope: מה כן, מה לא

‏טבלה של פיצ'רים שהsbb לא נוגע בהם **בכוונה**, ‏עם הפנייה ל-slice שבו יטופלו.

‏זו לא טבלת "TODO future" — ‏זו הגנה מפני הרחבת scope. ‏סוכן executor נוטה להוסיף "‏בעוד 10 שורות אפשר גם...".

### §3 — Architecture diagram

‏מינימום: ASCII diagram של 5 השכבות (לפי `packages/frontend/AGENTS.md`), ‏עם סימון מה חדש איפה (`← חדש`). ‏זה מונע מהexecutor למקם קוד בשכבה הלא נכונה.

### §4 — Commits בסדר

‏הסעיף הכי חשוב. ‏לכל commit:

- ‏**שם**: ‏קצר וברור
- ‏**Approach**: ‏`TDD` או `manual` או `mixed` (סעיף 1)
- ‏**קבצים חדשים**: ‏paths מלאים
- ‏**קבצים שמשתנים**: ‏paths + ‏מה משתנה ברמת bullets
- ‏**API skeleton**: ‏אם מוסיף class/function ציבורי — ‏סיגנטורה מלאה (TypeScript). ‏executor מותר לשנות **לא**.
- ‏**Verification**: ‏פקודות bash מדויקות שירוקות לפני git add

‏גודל מומלץ לcommit: ‏עד 200 שורות שינוי (לא כולל test). ‏commit גדול יותר — ‏לפצל.

### §5 — DoD verifiable

‏טבלה: ‏שורה לכל בדיקה. ‏עמודה אחת = ‏הבדיקה, ‏שנייה = ‏איך מבצעים (פקודה או צעדים ידניים).

‏לא "‏הכל עובד" — ‏רשימת checkbox קונקרטית.

### §6 — Risks + mitigations

‏לשלוף מ-`~/.config/opencode/learnings.md` ‏ומ-walkthrough של סבבים קודמים. ‏לכל סיכון:
- ‏מה היה הגוטשה / לקח קודם (עם מקור)
- ‏איך מונעים אותו בbrief הזה ספציפית

### §7 — Escalation triggers

‏רשימה שמתחילה ב-"‏אם X — ‏עצור ושאל את Tama בparent task":

- ‏החלטה ארכיטקטונית שלא מכוסה ב-D1-D50
- ‏ספרייה חיצונית נכשלת באופן שמעיד על stack שגוי
- ‏MediaSource / ‏WebAudio / ‏ספציפי לbrowser לא מתנהג כצפוי
- ‏BE proxy לא מועבר לupstream שדרוש לסבב
- ‏OneCLI לא מזריק credentials הצפויות

‏זה משלים את ה-section ב-AGENTS.md "Working with Tama".

### §8 — Complexity score + ‏verifier choice

‏לפי `planner-executor-research` skill:

‏Score מ-0 עד 10. ‏פרמטרים:
- ‏מספר commits (4-6 = ‏סביר, 7+ = ‏גבוה)
- ‏מספר שכבות חדשות (1 = ‏נמוך, 3 = ‏גבוה)
- ‏אינטגרציה עם APIs חיצוניים (כל אחד = +1)
- ‏Streaming / async pipelines (+2)
- ‏Refactor של state model (+2)
- ‏שינוי ב-protocol BE↔FE (+2)

**‏הכלל**:
- ‏0-7: ‏`verifier-slice-light` ‏מספיק
- ‏8-10: ‏`verifier-slice-heavy` — ‏פרוטוקול 7 שלבים, ‏בודק רגרסיות + ‏edge cases

‏לphases רגישות (state model refactor, ‏integration נקודתית): ‏`verifier-phase` ‏אחרי הcommit הספציפי.

### §9 — שאלות פתוחות

‏רשימה ממוספרת. ‏לכל שאלה: ‏ברירת מחדל מוצעת + ‏מי מחליט אם לא. ‏אם פתוחה — ‏לסמן "‏חוסם" או "‏לא חוסם".

---

## 3. ‏Section-by-section — ‏טיפים פרקטיים

### §0 (Pre-flight) — ‏הטעות הכי נפוצה

‏לכתוב "‏ראה AGENTS.md" ‏בלי לציין מה ספציפית. ‏הסוכן יקרא את כל המסמך ויבזבז context.

‏✅ ‏טוב: ‏"‏לקרוא §Worktrees ב-`AGENTS.md` ‏לפני שיוצרים worktree"
‏❌ ‏רע: ‏"‏לקרוא AGENTS.md"

### §3 (Architecture) — ‏ל-ASCII או לא?

‏ASCII diagram עולה ~30 שורות אבל חוסך 5K tokens של חיפוש. ‏שווה.

### §4 (Commits) — ‏API skeleton, ‏לא רק שמות

‏❌ ‏רע: "‏Speaker class with `play`, ‏`pause`, ‏`enqueue`"
‏✅ ‏טוב:

```ts
class Speaker {
  constructor(opts: { session: AgentSession; settings: Settings })
  enabled: boolean  // $state
  state: "idle" | "playing"  // $state, derived from player
  // emits to player automatically via $effect on session.bubbles
}
```

‏החתימה המדויקת מונעת מהexecutor להמציא API קצת אחר.

### §6 (Risks) — ‏מטה-לקח: ‏תמיד יש 3 שתמיד נשכחים

1. ‏**Hardcoded Hebrew** → ‏pre-commit hook יחסום. ‏כל מחרוזת → `t(key)`.
2. ‏**Svelte 5 reactivity על array** → ‏push לא מפעיל re-render אם הloop לא קורא ‏ל-`.length`. ‏השתמש ב-`{#each ... as ... (id)}` + ‏מקרא `.length` בblock.
3. ‏**OneCLI placeholder pattern** → ‏SDKs (`@ai-sdk/elevenlabs`, ‏`@ai-sdk/google`) ‏צריכים `apiKey` בconstructor. ‏העבר string placeholder, ‏OneCLI מחליף ב-proxy.

‏לבדוק את שלושתם בכל brief.

### §8 (Complexity) — ‏החישוב אינטואיטיבי

‏אם אתה מהסס בין light לheavy — ‏בחר heavy. ‏עלות נוספת ~20 דקות, ‏חוסכת bugs מאוחרים.

---

## 4. Checklist אחרון לפני handoff

‏לפני שמעבירים brief לexecutor agent:

### ‏Context completeness

- [ ] ‏סוכן חדש בלי context יודע **איך להריץ** אחרי קריאת §0?
- [ ] ‏סוכן חדש יודע **איזה browser** לפתוח?
- [ ] ‏אם יש tunnel — ‏ה-URL הצפוי כתוב?
- [ ] ‏אם יש OneCLI agent — ‏השם והפקודה כתובים?

### ‏Path specificity

- [ ] ‏כל קובץ חדש בbrief = ‏path מלא (לא "במקום כלשהו ב-FE")?
- [ ] ‏אם יש "copy מ-X" — ‏ה-path הספציפי + ‏branch + ‏מה לשנות בהעתקה?
- [ ] ‏אם יש "ראה X" — ‏ה-path + ‏section ספציפי?

### ‏API contracts

- [ ] ‏כל class/function ציבורי חדש = ‏TypeScript skeleton בbrief?
- [ ] ‏שינוי בAPI קיים = ‏before/after explicit?

### ‏Gotchas coverage

- [ ] ‏i18n: ‏מצוין שכל מחרוזת → `t(key)`?
- [ ] ‏Svelte 5 reactivity: ‏מצוין אם הסבב נוגע ב-`$state` arrays?
- [ ] ‏OneCLI: ‏מצוין אם הסבב נוגע ב-SDK חיצוני?
- [ ] ‏לקחים רלוונטיים נוספים מ-learnings.md הוזכרו?

### ‏Verification

- [ ] ‏כל commit מסעיף §4 = ‏פקודת verification?
- [ ] ‏ה-DoD בסעיף §5 = ‏טבלה עם בדיקות verifiable, ‏לא "‏הכל עובד"?

### ‏Handoff

- [ ] ‏Complexity score חושב?
- [ ] ‏Verifier choice מסומן (light/heavy)?
- [ ] ‏Escalation list ספציפי לסבב (לא רק generic)?
- [ ] ‏שאלות פתוחות סומנו "‏חוסם" / "‏לא חוסם"?

‏אם יש אפילו checkbox אחד לא מסומן — ‏ה-brief לא מוכן.

---

## 5. ‏Template skeleton

‏לcopy-paste בתחילת brief חדש:

```markdown
# Slice N — שם — תוכנית

> **תאריך**: YYYY-MM-DD
> **סטטוס**: ‏טיוטה / ‏מאושר / ‏בעבודה / ‏הושלם
> **Complexity**: X/10 (verifier: light/heavy)
> **תלות**: ‏slice K (סטטוס)

## §0 — Pre-flight

### Worktree
git worktree add .worktrees/slice-N-name -b slice-N-name dev
cd .worktrees/slice-N-name
pnpm install && pnpm hooks:install

### Run
- BE: `pnpm --filter @drive-coding/backend dev` (port 4000)
- FE: `pnpm --filter @drive-coding/frontend dev` (port: OS-assigned)
- Tunnel (אופציונלי): `<ssh command>`

### Browser
- ...

### OneCLI agent
- שם: `voice-acp`
- שימוש: `onecli run --agent voice-acp -- <cmd>` (להזרקת ElevenLabs + Google keys)

### Reading list
**must-read**:
- ...

**reference**:
- ...

## §1 — מטרה
פסקה אחת.

## §2 — Scope
| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| ... | ❌ | slice X |

## §3 — Architecture diagram
```
...
```

## §4 — Commits

### Commit 0 — שם (approach: TDD/manual/mixed)
**קבצים חדשים**: ...
**שינויים**: ...
**API skeleton**: ```ts ... ```
**Verification**: ```bash ... ```

### Commit 1 — ...

## §5 — DoD
| ‏בדיקה | ‏איך |
|---|---|
| ... | ... |

## §6 — Risks
| ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|
| ... | learnings YYYY-MM-DD | ... |

## §7 — Escalation triggers
- ...

## §8 — Complexity score
- ...

## §9 — שאלות פתוחות
| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ... | ... | ❌ |
```

---

## 6. ‏Lifecycle של תוכנית

| ‏שלב | ‏סטטוס | ‏פעולה |
|---|---|---|
| ‏טיוטה | `סטטוס: ‏טיוטה` | ‏planner כותב, ‏מקבל reviews |
| ‏מאושר | `סטטוס: ‏מאושר` | ‏ready להעברה לexecutor |
| ‏בעבודה | `סטטוס: ‏בעבודה` | ‏executor מבצע. ‏סטיות מתועדות במסמך (סעיף חדש "‏סטיות מהתכנון") |
| ‏הושלם | `סטטוס: ‏הושלם` | ‏slice מוטמע. ‏המסמך נשאר היסטוריה |

‏המסמכים נשארים תחת `docs/plans/` ‏גם אחרי השלמה — ‏מקור ללמידה לסבבים הבאים.
