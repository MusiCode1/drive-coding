# Parallel-Safe Code — additive design

> ‏**מעמד**: ‏קונבנציה חיה. ‏יתוקן ויורחב לפי ניסיון בפועל.
> ‏**עדכון אחרון**: ‏2026-05-28.
> ‏**שימוש**: ‏לקרוא בתחילת כל סבב פיתוח שמערב יותר מסוכן executor אחד, ‏או לפני קומיט שנוגע בקבצים משותפים.

---

## 1. למה זה קיים

‏אנחנו עובדים במודל של **‏סוכנים מקבילים ב-worktrees נפרדים**. ‏שני סוכנים יכולים לעבוד על slices שונים בו-זמנית, ‏כל אחד ב-`.worktrees/<slice>/` ‏משלו, ‏ולמרג' חזרה ל-`dev` כשמסיימים.

‏הבעיה: ‏כשמרג'ים שני worktrees שערכו את **אותו קובץ**, ‏נוצרים שני סוגי קונפליקטים:

| ‏סוג | ‏מה זה | ‏עלות פתרון |
|---|---|---|
| ‏**Surface (מכני)** | ‏אותו קובץ, ‏שורות שונות, ‏נושאים שונים | ‏Git auto-merge. ‏0 |
| ‏**Semantic (מהותי)** | ‏אותו קובץ, ‏אותו block, ‏אותה החלטה | ‏אדם פותר. ‏גבוהה |

‏**המטרה של הקונבנציה הזו**: ‏לארגן את הקוד כך ששינויים נוגעים-באותו-קובץ יהיו תמיד surface, ‏אף פעם semantic.

‏זה לא דורש פיצול קבצים אגרסיבי. ‏זה דורש דפוס כתיבה.

---

## 2. ההבחנה היסודית: Additive vs Invasive

‏**Additive** = ‏מוסיף תוכן חדש בלי לגעת בקיים.
‏**Invasive** = ‏משנה תוכן קיים (signature, ‏state model, ‏behavior).

| ‏שינוי | ‏סוג | ‏Parallel-safe? |
|---|---|---|
| ‏הוספת method חדשה ל-class | ‏Additive | ✅ |
| ‏הוספת variant חדש ל-discriminated union | ‏Additive | ✅ |
| ‏הוספת key חדש ל-i18n catalog | ‏Additive | ✅ |
| ‏הוספת component חדש לroute (בסוף section) | ‏Additive | ✅ |
| ‏הוספת case חדש ל-switch | ‏Additive | ✅ |
| ‏הוספת זוג `get/set` ל-context | ‏Additive | ✅ |
| ‏שינוי signature של function קיימת | ‏Invasive | ❌ |
| ‏refactor של state model | ‏Invasive | ❌ |
| ‏שינוי סדר init ב-+layout | ‏Invasive | ❌ |
| ‏שינוי behavior של method קיימת | ‏Invasive | ❌ |
| ‏rename של field/method | ‏Invasive | ❌ |

‏**כלל זהב**: ‏רוב slices ‏עתידיים הם בעיקר additive. ‏שינויים invasive נדרשים מדי פעם — ‏הם דורשים תכנון של ה-planner ולא יורצו במקביל.

---

## 3. חמש הטכניקות לadditive growth

### ‏טכניקה 1: ‏Discriminated unions במקום branches מבוזרים

‏במקום `if (bubble.type === ...)` ‏מפוזר בקוד, ‏מודל מרכזי עם variants:

```ts
type Bubble = UserBubble | MessageBubble | ThoughtBubble | ToolBubble
```

‏slice חדש שמוסיף `SystemBubble` מוסיף **שורה אחת** ל-union + ‏variant חדש. ‏אחרים לא משתנים.

‏**מועיל ל**: ‏Bubble, ‏Notification, ‏Error, ‏VoiceMode state, ‏ToolCall status.

### ‏טכניקה 2: ‏Switch dispatchers ב-leaf components

‏ה-route ‏לא עושה switch בעצמו — ‏הוא קורא ל-component dispatcher:

```svelte
<!-- chat/+page.svelte (נשאר 30 שורות לעולם) -->
{#each session.bubbles as bubble (bubble.id)}
  <BubbleRenderer {bubble} />
{/each}

<!-- BubbleRenderer.svelte -->
<script>let { bubble } = $props()</script>

{#if bubble.kind === "message"}    <MessageBubble {bubble} />
{:else if bubble.kind === "thought"} <ThoughtBubble {bubble} />
{:else if bubble.kind === "tool"}    <ToolBubble {bubble} />
{:else if bubble.kind === "user"}    <UserBubble {bubble} />
{/if}
```

‏slice 4 ‏מוסיף `{:else if bubble.kind === "tool"}` — ‏שורה חדשה, ‏שאר השורות לא משתנות. ‏Git auto-merge.

‏**מועיל ל**: ‏Bubble rendering, ‏notification rendering, ‏route dispatchers.

### ‏טכניקה 3: ‏Sectioned shared files עם header comments

‏גם קבצים שנשארים flat — ‏חלוקה ויזואלית מבטיחה שתי-עריכות-נופלות-בsections-שונות:

```ts
// lib/context.ts

// ─── i18n ────────────────────────────────────────
const I18N_KEY = Symbol('i18n')
export const setI18n = ...
export const getI18n = ...

// ─── Session ────────────────────────────────────
const SESSION_KEY = Symbol('session')
export const setSession = ...
export const getSession = ...

// ─── Speaker ────────────────────────────────────
// ...

// ─── Mic ─── ‏(slice 3 ‏יוסיף כאן)
```

‏זו **לא refactor**. ‏זו קונבנציה לפורמט. ‏עלות: ‏5 ‏דקות לקובץ. ‏ROI: ‏שני סוכנים מוסיפים sections שונים = ‏Git auto-merge.

‏**מועיל ל**: ‏`context.ts`, ‏`+layout.svelte` ‏(blocks של VM init), ‏`vite.config.ts`, ‏`tsconfig.base.json`.

### ‏טכניקה 4: ‏Append-only catalogs

‏ל-`i18n/keys.ts`, ‏list של constants, ‏או כל union ‏שגדל הרבה:

```ts
export type MessageKey =
  // ─── connect ─── slice 0
  | "connect.cliKind"
  | "connect.cwd"
  | "connect.submit"
  // ─── chat ─── slice 0.5 + ‏slice 2
  | "chat.placeholder"
  | "chat.send"
  | "chat.audioToggle"  // slice 2
  // ─── mic ─── slice 3 ‏יוסיף כאן
  // ─── voice mode ─── slice 3
  // ─── car mode ─── slice 7
```

‏**מועיל ל**: ‏i18n keys, ‏i18n catalogs, ‏list של commands, ‏list של routes.

### ‏טכניקה 5: ‏Domain-ordered methods ב-VMs

‏כשclass גדל ושני סוכנים מוסיפים methods שונות:

```ts
class AgentSession {
  // ─── state ─── (‏לא לגעת אלא בinvasive coordinated)
  status = $state(...)
  bubbles = $state(...)

  // ─── connection lifecycle ───
  attach = async (...) => {...}
  detach = (...) => {...}

  // ─── prompting ───
  sendPrompt = async (...) => {...}

  // ─── session persistence ─── (slice 8 ‏יוסיף)
  // loadSession?
  // listSessions?

  // ─── recordings ─── (slice 10 ‏יוסיף)

  // ─── private ───
  #cleanup() {...}
}
```

‏slice 8 ‏מוסיף ב-section ‏שלה. ‏slice 10 ‏ב-section שלה. ‏Git auto-merge.

‏**מועיל ל**: ‏VMs גדולים (`AgentSession`, ‏עתידי `Speaker`, ‏עתידי `Mic`).

---

## 4. כללים לסוכנים (executor agents)

‏כללים מחייבים בכל commit שנוגע בקובץ משותף:

1. ‏**Additive only**: ‏הוסף entries/methods/variants. ‏אל תשנה קיימים.
2. ‏**Section headers**: ‏אם הקובץ משתמש ב-`// ─── domain ───` ‏— ‏עבוד רק בsection ‏הרלוונטית ל-slice שלך. ‏אם אין section ‏מתאימה, ‏הוסף section חדשה בסוף.
3. ‏**Append at end of section**: ‏אל תשרבב באמצע. ‏השורות הקיימות נשארות במקומן.
4. ‏**Imports**: ‏imports נוספים ב-block המתאים (e.g., ‏imports של svelte, ‏imports של $lib, ‏imports יחסיים). ‏אם יש imports group ‏מסומן — ‏הוסף בסוף הgroup.
5. ‏**שינוי invasive**: ‏אם ה-slice דורש שינוי signature, ‏refactor של state, ‏rename — ‏**עצור ושאל את Tama**. ‏זה דורש קומיט preparation נפרד לפני עבודה parallel.
6. ‏**Order doesn't matter**: ‏אל תבזבז זמן על "‏לסדר אלפבתית" ‏או "‏לקבץ נכון". ‏זה אינטרס invasive.

---

## 5. דוגמאות מהcodebase voice-acp

### ‏פועל היום

| ‏קובץ | ‏הטכניקה | ‏עדות |
|---|---|---|
| ‏`packages/frontend/src/lib/types/bubble.ts` | ‏discriminated union (#1) | ‏4 ‏variants, ‏slice 4 ‏יוסיף ToolBubble |

### ‏ידרוש שינוי לacceptance

| ‏קובץ | ‏טכניקה לתחזק | ‏שינוי נדרש |
|---|---|---|
| ‏`packages/frontend/src/lib/context.ts` | #3 ‏sectioned headers | ‏הוספת `// ─── <domain> ───` ‏לכל זוג קיים |
| ‏`packages/frontend/src/routes/+layout.svelte` | #3 ‏sectioned + #5 ‏(VM ‏list ‏בסדר ‏domain) | ‏הוספת ‏headers |
| ‏`packages/core/src/i18n/keys.ts` | #4 ‏append-only ‏עם headers | ‏הוספת ‏headers ‏לkeys ‏קיימים |
| ‏`packages/core/src/i18n/catalogs/{he,en}.ts` | #4 | ‏headers |
| ‏`packages/frontend/src/routes/chat/+page.svelte` | #2 ‏switch dispatcher | ‏חילוץ ‏BubbleRenderer (component חדש) |
| ‏`packages/frontend/src/lib/view-models/agent-session.svelte.ts` | #5 ‏domain-ordered methods | ‏הוספת ‏headers |

‏המעבר ‏לקונבנציה ‏עצמו ‏זה ‏invasive change — ‏צריך ‏לעשות ‏אותו ‏בקומיט ‏preparation ‏אחד ‏לפני ‏עבודה ‏parallel.

---

## 6. מתי לא parallel-safe

‏הקונבנציה לא פותרת הכל. ‏מקרים שדורשים sequential:

1. **‏State model refactor**: ‏שינוי הshape של state share — ‏invasive בהגדרה. ‏planner מסדר.
2. **‏Signature change של פונקציה ציבורית**: ‏אם 2+ ‏consumers — ‏invasive.
3. **‏Order-sensitive init**: ‏אם slice חדש דורש VM שלו לפני אחרים ב-+layout, ‏זה invasive.
4. **‏Shared state semantics**: ‏שני agents מנהלים את אותו `$state` field — ‏גם אם הם אומרים "‏רק append", ‏ה-semantics ‏מסובכים.

‏במקרים אלה: ‏slice אחד רץ, ‏מסיים, ‏ממורג'. ‏רק אז ה-slice הבא מתחיל.

---

## 7. מתי לא להוסיף section header

‏הוספת headers זה overhead. ‏שווה רק כש:

- ‏הקובץ צפוי להיגעת ב-2+ slices ‏עתידיים, ‏או
- ‏הקובץ כבר ארוך מ-100 ‏שורות, ‏או
- ‏הקובץ נמצא ב-bottleneck list (ראה §5)

‏לקובץ של פיצ'ר ספציפי (e.g., ‏`view-models/speaker.svelte.ts`) — ‏אין צורך בheaders בתוכו, ‏רק בקבצים המשותפים שהוא נוגע בהם.

---

## 8. ברירת מחדל כשמתעוררת ספק

‏אם לא בטוח אם השינוי additive או invasive:

1. ‏בדוק האם השינוי משנה behavior של code שכבר עובד → ‏invasive.
2. ‏בדוק האם consumers ‏צריכים שינוי → ‏invasive.
3. ‏בדוק האם הtest קיים נופל → ‏invasive (גם אם נראה additive).
4. ‏אם אפילו אחד מאלה כן → ‏עצור ושאל את Tama.

---

## 9. סטטוס היישום

| ‏פריט | ‏סטטוס |
|---|---|
| ‏הקונבנציה נכתבה | ✅ |
| ‏Pointer ב-`AGENTS.md` (root) | 🟡 ‏צריך להוסיף |
| ‏Pointer ב-`packages/frontend/AGENTS.md` | 🟡 ‏צריך להוסיף |
| ‏Section headers ב-4 ‏הקבצים | 🟡 ‏ממתין לpreparation commit |
| ‏BubbleRenderer extraction | 🟡 ‏ממתין |
| ‏יישום בbriefs הבאים | 🟡 ‏slice 3+ ‏ינחו לפי המסמך |

---

## 10. שיפורים אפשריים בעתיד

‏רעיונות שלא יושמו עוד, ‏לבחון לפי ניסיון:

- **‏Linter rule** ‏שחוסם invasive change ב-shared files בלי tag מפורש בcommit message
- **‏Section table-of-contents** ‏בראש קבצים גדולים (`// SECTIONS: i18n, session, speaker, mic`)
- **‏Feature folders** (`features/<name>/`) — ‏refactor כבד יותר, ‏שמתאים כשהcodebase גדל מעל סף מסוים
- **‏Convention-over-config** ‏לbootstrap: ‏vite glob `import.meta.glob('./view-models/*.svelte.ts')` ‏ל-auto-register
- **‏Pre-commit check** ‏שמודיע אם השינוי נוגע ב-bottleneck file שלא לפי הקונבנציה

---

## 11. למי המסמך הזה מיועד

- ‏**Planner (Tama/Opus)**: ‏לקרוא לפני כתיבת brief לסבב מקבילי. ‏לוודא שהbrief מסמן additive/invasive נכון לכל commit.
- ‏**Executor (Sonnet)**: ‏לקרוא לפני נגיעה בקובץ משותף. ‏לוודא ש-section headers מכובדים ושהשינוי הוא additive.
- ‏**Verifier**: ‏לבדוק שה-commit לא הכניס invasive change בלי תיעוד.

‏המסמך **‏לא** ‏מיועד לסשנים של planning/architecture כללי — ‏הוא ספציפי לשינויים ברמת הקוד.
