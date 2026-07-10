# Slice — slash-menu-native — תוכנית (הרחבת slice-slash-commands, גישה B)

> **תאריך**: 2026-07-07
> **סטטוס**: הושלם — Commits 5+6 על `slice/slash-commands` (`29ac9ab` + `2e02ae3`; calev light ממתין)
> **Complexity**: 5/10 (verifier: light)
> **תלות**: `depends_on: []` — Commits נוספים על ה-worktree הקיים `slice/slash-commands`
> **base**: `slice/slash-commands` @ `abb0b78` (4 commits קיימים; טרם merge — ר' decisions 2026-07-07 "תיקון-כיוון")

---

## §1 — מטרה

ה-slash menu עובד (GO×2), אבל חסרות לו התנהגויות של **listbox native**: (א) ניווט-חיצים לא גולל את
הפריט המודגש לתצוגה → הוא יוצא מהחלון הנגלל (`max-h-64`) והמשתמש לא רואה אותו (**באג שנתפס חי**);
(ב) אין Home/End; (ג) אין ARIA `listbox`. הסלייס משלים את הפער — **בלי** bits-ui `Command` (שלא מתאים
ל-inline-autocomplete בתוך textarea — ר' decisions). בנוסף, קומיט **מבודד** מוסיף **ghost-hint ב-input**:
אחרי בחירת פקודה עם ארגומנט, רמז-הארגומנט מוצג בתוך אזור-הקלט (כמו CLI) כל עוד לא הוקלד ארגומנט.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| scroll-into-view של הפריט המודגש בניווט-חיצים | ✅ | Commit 1 |
| Home / End (קפיצה לראשון/אחרון) | ✅ | Commit 1 |
| ARIA `listbox`/`option` + `aria-activedescendant` | ✅ | Commit 1 |
| ghost-hint ב-input (רמז-ארגומנט אחרי בחירה) | ✅ **קומיט מבודד** | Commit 2 |
| wrap-around בחיצים | ⏭️ כבר קיים (modulo, TypeArea:283/288) — לא לגעת |
| PageUp/PageDown | ❌ | future (לא native-critical לרשימה קצרה) |
| enum-cycling בין ערכי-hint (`[low|medium|…]`) | ❌ | future — parsing שביר (ר' decisions) |
| bits-ui `Command`/`Combobox` ל-slash | ❌ | נדחה — inline-autocomplete, לא standalone |
| שינוי `ui/Select` הרוחבי | ❌ | סלייס נפרד `native-select-parity` (C) |

---

## §3 — עובדות-קוד מאומתות (לאביגיל לאמת)

- **State ב-`TypeArea.svelte`** (slice-slash-commands, Commit 2): `selectedIndex` (`$state`, :38),
  `slash` (`$derived(matchSlashCommands(...))`, :39), `menuOpen` (`$derived`, :40), `dismissed` (:37),
  `menuRect` (:62). `$effect` מאפס `selectedIndex=0` על שינוי `slash.matches.length` (:50-51).
- **keydown handler** ב-`TypeArea.svelte:275+`: intercept כש-`menuOpen && slash && !(Cmd/Ctrl+Enter)`;
  `ArrowDown`→`(selectedIndex+1)%n` (:283), `ArrowUp`→`(selectedIndex-1+n)%n` (:288) — **wrap כבר קיים**;
  Enter/Tab בוחרים (:293), Escape→`dismissed=true` (:302). **כאן מוסיפים Home/End.**
- **`SlashCommandMenu.svelte`**: `<ul class="fixed max-h-64 overflow-y-auto …" use:portal>` (portal ל-`document.body`);
  `{#each matches as cmd, i (cmd.name)}` → `<li><button>` (:53-67); ה-highlight לפי `i === selectedIndex` (:58).
  **כאן מוסיפים scroll-into-view + ARIA roles** — ה-DOM של הרשימה כאן (לא ב-parent).
- **Props של `SlashCommandMenu`**: `{ matches, selectedIndex, onselect, rect }` (:22-32). ה-`selectedIndex` כבר מגיע
  → אפשר `$effect` שמגיב לו לגלילה. אין צורך ב-prop חדש (אולי `textareaId` ל-`aria-activedescendant` — ר' §4).
- **auto-grow קיים** (`$effect` על `promptText`, TypeArea:~90) — רלוונטי ל-Commit 2 (ה-ghost מעל textarea בגובה משתנה).

---

## §4 — מימוש

### Commit 1 — `feat(frontend): slash-menu listbox parity — scroll-into-view + Home/End + ARIA`

**ב-`SlashCommandMenu.svelte`**:
- `bind:this` על כל `<li>` (או על ה-`<button>`) לתוך מערך, **או** `querySelector` לפי `data-index`; `$effect`
  שמגיב ל-`selectedIndex` וקורא `el.scrollIntoView({ block: "nearest" })` על הפריט המודגש. `block:"nearest"`
  מונע קפיצות מיותרות (גולל רק כשצריך). לשים לב: ה-`<ul>` ב-portal ל-body — `scrollIntoView` עובד על ה-element ישירות.
- **ARIA**: `<ul role="listbox" id="slash-listbox">` — **ה-`<ul>` חייב `id` משלו** (קבוע, למשל `"slash-listbox"`),
  כי הוא **portal ל-`document.body`** (לא DOM-descendant של ה-textarea) → הקישור combobox↔listbox תלוי לגמרי
  ב-`aria-controls` שמצביע ל-id הזה. **ה-`role="option"` + `aria-selected={i===selectedIndex}` + `id="slash-opt-{i}"`
  יושבים על ה-`<button>` עצמו — לא על ה-`<li>`** (option שמכיל אלמנט אינטראקטיבי = ARIA anti-pattern; ה-`<button>`
  הוא האלמנט הנבחר/הקליקבילי, אז ה-role עליו). ה-`<li>` נשאר wrapper סמנטי בלבד.
  (ה-`aria-controls`/`aria-activedescendant` על ה-textarea — בצד ה-parent, ר' למטה.)

**ב-`TypeArea.svelte`** (keydown, בתוך ה-`if (menuOpen && slash && …)` הקיים):
- `Home` → `selectedIndex = 0` (`preventDefault`); `End` → `selectedIndex = slash.matches.length - 1` (`preventDefault`).
- על ה-`<textarea>`: `role="combobox"` + `aria-expanded={menuOpen}` + `aria-controls={menuOpen ? "slash-listbox" : undefined}`
  + `aria-activedescendant={menuOpen ? "slash-opt-"+selectedIndex : undefined}` (`aria-controls` מצביע ל-id של ה-`<ul>`,
  `aria-activedescendant` לפריט המודגש — מקשר combobox↔listbox חוצה-portal; קורא-מסך מכריז את הפריט. הכל מותנה ב-`menuOpen`).

**אין** חילוץ ל-action גנרי (`use:listboxNav`) — הלוגיקה מפוצלת parent/child וה-`ui/Select` ילך ל-bits-ui
(לא ישתף), אז abstraction עכשיו = over-engineering. מימוש ממוקד בשני הקבצים.

### Commit 2 — `feat(frontend): slash-menu ghost-hint ב-input (מבודד)` **[קל-revert]**

מטרה: כשה-textarea מכיל **בדיוק** `/<command> ` (פקודה עם `input.hint` נבחרה, רווח אחריה, בלי ארגומנט), הצג את
ה-`hint` כ-**ghost** אפור-עמום בהמשך אותה שורה, פנימית לאזור-הקלט. נעלם ברגע שהמשתמש מקליד ארגומנט.

- **גישה מועדפת — overlay-mirror**: `<div>` מאחורי ה-textarea (`pointer-events:none`, אותו font/padding/line-height),
  מציג `<span invisible>{promptText}</span><span class="ghost">{hint}</span>`. ה-hint נגזר: **סרוק את
  `session.availableCommands`** (‏**‏לא** `slash.matches`!) ומצא את הפקודה ש-`"/"+cmd.name+" " === promptText`,
  קח `cmd.input?.hint`. ⚠️ **קריטי**: במצב `/name ` (‏רווח-נגרר) ‏`matchSlashCommands` מחזיר **`null`**
  (`slash-commands.ts:31`: `if (rest.includes(" ")) return null`) → `slash` הוא null ו-`menuOpen` false; ‏לכן ה-ghost
  **‏חייב** לצאת מ-`session.availableCommands` ‏הישיר, ‏ולא להסתמך על `slash`. `aria-hidden` על ה-overlay.
- **Fallback אם overlay מסתבך** (auto-grow/wrap/scroll-sync): רמז-chip **מתחת** לשורת-הקלט (`/code-review → [low|medium|…]`),
  עדיין מבודד. הכרעה חזותית ב-preview.
- **בידוד**: קומיט עצמאי, נוגע רק ב-TypeArea (overlay) — `git revert <sha>` מסיר אותו בלי לגעת ב-Commit 1.

---

## §5 — Testing strategy + DoD

**Testing**: `manual/browser` (FE-only, keyboard/visual). `pnpm typecheck`=0. `biome check` פרטני נקי.

**DoD — Commit 1 (listbox parity)**:
1. `pnpm typecheck` = 0.
2. חי (claude, רשימה ארוכה כמו `/` בלי סינון — ~58 פקודות): `ArrowDown` רצוף **גולל** את הרשימה כך שהפריט
   המודגש **תמיד נראה** (לא יוצא מ-`max-h-64`). זהו תיקון הבאג.
3. חי: `Home` קופץ למודגש-ראשון (וגולל למעלה); `End` לאחרון (וגולל למטה).
4. חי: wrap-around עדיין עובד (ArrowUp מהראשון → אחרון, וגלילה עוקבת).
5. a11y: ב-DevTools, ה-`<ul>` = `role=listbox`, הפריט המודגש `aria-selected=true`, ה-textarea נושא
   `aria-activedescendant` שמצביע ל-id הנכון (מתעדכן בניווט).
6. רגרסיה: פתיחה/סינון/בחירה (Enter/Tab/קליק)/Escape/שליחה-רגילה — כולם כמו קודם (0 רגרסיה על 4 הקומיטים).

**DoD — Commit 2 (ghost-hint, מבודד)**:
7. חי: בחירת `/code-review` (Enter/קליק) → ה-hint מוצג כ-ghost בהמשך השורה; הקלדת תו-ארגומנט → ה-ghost נעלם.
8. חי: פקודה בלי `input` (`/context`) → אין ghost.
9. הקומיט מבודד: `git show <sha> --stat` נוגע רק ב-TypeArea (+overlay); `git revert` נקי-בתאוריה (לא נבדק בפועל, רק מבני).

---

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| `scrollIntoView` על element ב-portal קופץ את **הדף** (לא רק הרשימה) | ה-`<ul>` ב-body, `block:"nearest"` | `block:"nearest"` גולל רק את ה-scroll-container הקרוב (ה-ul); אימות DoD#2 |
| `aria-activedescendant` על textarea עם `role=combobox` משנה קריאת-מסך של הקלט הרגיל | ARIA על textarea | להתנות ב-`menuOpen` בלבד; כשסגור — אין role/activedescendant. אימות DoD#5 |
| ghost-overlay לא מיושר עם textarea (auto-grow, RTL, wrap) | Commit 2 | קומיט מבודד + fallback ל-chip; הכרעה ב-preview; לא חוסם את Commit 1 |
| bidi: hint אחרי `/name` בכיוון-app | נתפס ב-Commit 4 (לא רגרסיה) | עקבי, מחוץ ל-scope |

---

## §7 — Complexity

**5/10** — Commit 1 (scroll+keyboard+ARIA) ~3, Commit 2 (ghost-overlay) ~4, borderline. verifier: **light**
(אין לוגיקה-טהורה חדשה ל-TDD; הכל תצוגה/keyboard/a11y חי).

## §8 — הערות merge

מתמזג **יחד** עם הבסיס (`slice/slash-commands`, כעת 6 commits) כ-merge אחד ל-dev. סדר: Commit 1 (parity)
לפני Commit 2 (ghost) — כדי שאם ה-ghost יידחה/יְ-revert, ה-parity נשאר. אחרי calev GO + preview מחודש
שהמשתמשת מאשרת → merge. אם ghost לא משכנע ב-preview — `git revert` על Commit 2 בלבד, וממזגים 5 commits.
