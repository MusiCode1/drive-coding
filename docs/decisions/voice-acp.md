# Decisions — voice-acp

## 2026-06-01 — redesign vNext: חלוקה ל-slices + foundation-first

### רציונל החלוקה
שיפוץ העיצוב (spec: `docs/plans/redesign-vnext.md`, anchor: `redesign-vnext-mockup.html`)
מפורק לפי עיקרון מנחה: **הפרדה בין "custom UI" ל-"primitives"**. ה-foundation ראשון
(תשתית בלבד), ואחריו ה-slices מסודרים כך שכל מה ש-headless component-lib *לא* נוגעת בו
(layout shell, mic, bubbles, avatars, header) בא **לפני** מה שכן (Settings=Switch/Select,
Modals=Dialog/Sheet). זה לא שרירותי — זה מתזמן את ההכרעה על ה-component-lib לרגע שבו
יהיה הכי הרבה מידע (קוד אמיתי, RTL נבדק), בעלות-טעות מינימלית.

הפירוק (JIT — רק foundation נכתב כ-brief מלא כעת; השאר כותרות):
1. **redesign-1 foundation** (complexity 5, depends_on []) — Tailwind 4 + 4 themes + Lucide. תשתית שקופה, לא נוגע במסכים.
2. **redesign-2 layout shell** (depends_on [1]) — AppShell/AppHeader/Sidebar+BottomSheet (A1/A2/A3/A4/A5/H). custom לגמרי. ה-BottomSheet drag → אולי vaul-svelte, נבדק שם.
3. **redesign-3 settings** (depends_on [1,2]) — SettingsScreen (D1/D2). **כאן ההכרעה על component-lib** (Switch/Select). חופף ל-slice 9a (speech toggles) — לתאם, לא לכפול.
4. **redesign-4 input+mic** (depends_on [1,2]) — RecordFooter, toggle הקלדה/הקלטה, mic 110px (B1/B2/B3/B4). custom.
5. **redesign-5 bubbles** (depends_on [1,2]) — ToolBubble align (C2), avatars (C3), פלטה על בועות (C4). **כולל באג segments C1 — slice ייעודי עם plan-verify** (data-model).
6. **redesign-6 modals** (depends_on [1,2,3]) — SessionsScreen (E1) + FolderPicker (E2) + Dialog. תלוי בהכרעת component-lib מ-3.
7. **redesign-7 smart-scroll** (depends_on [1,2]) — G1 (jump-down) + A5. ♻️ מ-v1.

C1 (באג segments) ו-C2 (tool align) הם תיקוני-באג שאפשר לשחרר מוקדם — אבל **לא לפני foundation**
(שניהם נוגעים בקומפוננטות שייכתבו מחדש; פיצול מהקשר העיצובי = עבודה כפולה). לכן נשארים תחת redesign-5.

### ההכרעה על component-lib — מתוזמנת, לא פתוחה-באוויר
**Bits UI כמוביל; הכרעה סופית ב-redesign-3 (Settings).** רציונל: ה-foundation לא צריך ספרייה
(Tailwind+themes+icons בלבד), אז המתנה חינמית; וה-primitives (Sheet/Select/Dialog/Switch)
מרוכזים ב-2 slices בלבד (3+6) → עלות-אימוץ ועלות-החלפה נמוכות. הערך של headless lib הוא
**ההתנהגות הבלתי-נראית** (a11y/aria, focus-trap+restore, ניהול-מקלדת, scroll-lock, click-outside,
positioning) — לא העיצוב (שאנחנו עושים מצוין ב-Tailwind, כפי שהמוקאפ מוכיח). Bits מנצח על Melt
כי הוא קומפוננטות-מוכנות runes-native (Melt = builders low-level; אנחנו בונים אפליקציה, לא ספרייה).
**סייג**: אם Bits נלחם ב-RTL/עיצוב על Select — חזרה ל-native styled `<select>` היא תשובה לגיטימית.

### redesign-2: multi-route + AppShell-as-component (לא single-page/route-group)
המוקאפ הוא single-page (`data-view` שמתחלף ב-JS) — זה **artifact של HTML סטטי**, לא הוראת-מימוש.
במוצר נשארים **multi-route** (`/`, `/chat`, `/settings`), וה-shell המשותף הוא **קומפוננטה עוטפת**
(`AppShell` ב-lib/components/layout) עם `{@render children()}`, **לא** route-group (`(name)/`) ו**לא**
nested `+layout`. רציונל: route-group = הזזת קבצים invasive; AppShell-component = אפס הזזה, שומר
חוק-זהב #1 (לא route ענק), משותף ל-chat+settings. (אביגיל אישרה: תבנית Svelte 5 ישימה, אין מלכוד.)

### redesign-2: scroll ownership עובר ל-AppShell (תיקון double-scroll)
אביגיל תפסה: ChatBubbles **כבר** scroll-container (overflow-y:auto + auto-scroll $effect), וה-AppShell
עוטף ב-scroll נוסף → double-scroll ששובר את הגלילה. **הכרעה**: ה-scroll עובר ל-AppShell; ChatBubbles
מאבד את ה-overflow+bind:this+$effect (הופך ל-content בלבד). ה-auto-scroll $effect עובר ל-AppShell
(חוק-זהב #4 — owner של ה-DOM node). redesign-7 (smart-scroll) יושב על אותו scroll-container.

### redesign-2: disconnect + audio-master עוברים ל-AppHeader (מניעת רגרסיה)
ChatHeader הנמחק החזיק `onDisconnect` (session.detach) + audio-toggle (speaker.enabled/toggle).
ה-AppHeader של המוקאפ לא כולל אותם. כדי לא לאבד פונקציונליות: שניהם נשמרים ב-AppHeader כאייקונים
(LogOut + Volume2/VolumeX). **ימוקמו מחדש ב-redesign-3**: disconnect→SessionOptionsPanel, audio-master→
SettingsScreen ליד 3 ה-toggles המפורטים. (אביגיל #1.)

### redesign-3: Bits UI Switch ✅, native Select (fallback) ✅ — מתועד

בוחרים **Bits UI Switch** (Root+Thumb) עם ה-`.toggle` CSS helper מ-app.css — RTL-safe, a11y מובנה.
**Native styled `<select>`** (לא Bits Select): Bits Select דורש Portal + JS overhead + RTL quirks שמסובכים לצרוך. ה-brief (§7) אישר: "fallback native styled select — לגיטימי". SelectOpts מוחזרים כ-props פשוטים. תועד ב-`components/ui/Select.svelte` (comment).

### redesign-3: בולע את slice 9a (לא מבוצע בנפרד)
slice 9a (speech toggles, plan-verified, base dev) נבלע ל-redesign-3 כדי לא לעצב toggles פעמיים
(פעם CSS גלם ב-9a, פעם Bits/Tailwind ב-redesign-3). הלוגיקה זהה (Settings fields + Speaker getters,
processedSegments מונע בליעה), העיצוב לפי המוקאפ. **9a מסומן superseded — לא יבוצע.**
VoicePicker **לא נמחק** (connect route משתמש בו, +page.svelte:92) — reuse בתוך SettingsScreen.

### redesign-5: C1 (segments bug) = rendering-only, לא data-model refactor
ה-spec רמז "אולי slice עם data-model refactor". אחרי בדיקת קוד: **לא צריך.** ה-Speaker צורך
`bubble.segments` כ-buffer ומריץ splitIntoSentences בעצמו (לא מסתמך על segment=משפט); MessageBubble
כבר עושה join לטקסט רץ. רק **ThoughtBubble** עושה div-per-segment (זה הבאג). התיקון: ThoughtBubble
מרנדר טקסט-רץ (מקור) / per-משפט (מתורגם). ה-data-model של segments **נשאר** — Speaker+thought-translation
תלויים בו. (חוסך slice שלם של refactor מסוכן.)

### foundation = תשתית שקופה (לא ממיר קומפוננטות)
ה-foundation **לא** ממיר את 14 הקומפוננטות הקיימות ל-Tailwind ולא משנה אף מסך. הוא מגדיר את
אותם שמות-tokens (`--bg`/`--fg`/`--accent`...) שהקומפוננטות כבר צורכות דרך `var()`, כך שהן
ממשיכות לעבוד זהה. המיגרציה בפועל קורית slice-by-slice כשכל אזור נכתב-מחדש מהמוקאפ. זה מכבד
חוק-זהב #5 (אסור backward-compat-in-place — או refactor מלא של אזור, או לא לגעת). DoD דורש
ש-/chat ייראה **זהה** לפני/אחרי (regression check ויזואלי).

### ממצאי אביגיל (foundation, 2 סבבים)
- סבב 1: USABLE-AFTER-FIX. blocker #1: כל פקודות `pnpm --filter @drive-coding/frontend` נכשלות —
  שם ה-package הוא `@drive-coding/frontend-v2` (התיקייה `frontend/` אך השם הפנימי נשאר -v2 מה-cutover).
  +2 בלבולים: גרסת Lucide שגויה (`^0.500.0` — `@lucide/svelte@next`=1.3.x), נתיבי `var(--muted)` חסרי `chat/`.
- spot-check מלא עבר: context.ts createContext, +layout additive, SPA-only, token-coverage, plugin-order, חוק-זהב #4.
- סבב 2 אחרי תיקון: **READY**. findings #4 (Icon value-export — fallback מכסה) ו-#5 (Heebo לא נטען — regression-neutral) התקבלו כ-wontfix מתועדים.

### רעיונות שנדחו
- **מיגרציה הדרגתית של Tailwind** (page-by-page side-by-side): נדחה — המשתמשת הכריעה מיגרציה מלאה. אבל "מלאה" ≠ "במכה אחת": ה-foundation תשתית, ההמרה slice-by-slice.
- **לכתוב את 5 ה-primitives ידנית** (בלי component-lib): נדחה כברירת-מחדל — a11y+focus-trap עבודה אמיתית עם סיכון-באגים. נשאר כ-fallback ל-Select אם Bits נלחם ב-RTL.
- **לפצל C1/C2 ל-slices מוקדמים עצמאיים** (לפני foundation): נדחה — שניהם נוגעים בקומפוננטות שייכתבו מחדש; פיצול = עבודה כפולה.
- **Skeleton UI**: נדחה (§1.2 spec) — opinionated, "look" גנרי, מתנגש בפלטה הייחודית.
## 2026-06-02 — redesign debug: סטיות מהתוכנית בדיבוג ההרכבה המצטברת (worktree redesign-7)

אחרי שכל 7 ה-slices של ה-redesign בוצעו (calev GO בבידוד) אך לא מוזגו, ההרכבה
המצטברת (tip redesign-7) נבדקה במובייל אמיתי והתגלו באגים שאף slice לא תפס
בבידוד. התיקונים בוצעו ישירות ב-worktree redesign-7 (לא brief/executor — באגי
layout שאובחנו במדויק), בשיטת "מרדכי מבצע + verifier אחרי". להלן כל הסטיות מהתוכנית.

### למה הבאגים נפלו בין הכיסאות
calev בדק כל slice בבידוד — שם כל אחד תקין. הבאגים נולדו מ-**ההרכבה** + מ-**נתונים
אמיתיים** (שיחה ארוכה עם בלוקי קוד), שלא נבדקו ב-isolation. זה חיזק את הצורך
בכלי ה-mock (ר' למטה) ובבדיקה על נתונים אמיתיים, לא רק happy-path ריק.

### B1 — RecordFooter: child בתוך scroll → footer slot כ-sibling shrink-0
**תוכנית (redesign-4/7):** RecordFooter רונדר בתוך `children` של ה-scroll → נגלל וצף
באמצע בסשן ריק. **תיקון:** AppShell חושף snippet slot נפרד `footer`, sibling של
`.chat-scroll`, מעוגן `shrink-0` בתחתית (כמו ChatColumn במוקאפ). `chat/+page.svelte`
מעביר RecordFooter דרך `{#snippet footer()}`. הוסר `onDisconnect` prop drilling.

### B2 — disconnect+audio: חוב מ-redesign-2 שלא נפדה → הועברו ל-SessionOptionsPanel
**שורש:** redesign-2 מחק את ChatHeader אך השאיר disconnect+audio ב-AppHeader זמנית
(הערת "ימוקם מחדש ב-redesign-3"). redesign-3 לא קלט את ה-chit ל-DoD שלו → 4 פקדים
ב-header → הכותרת הממורכזת (absolute) חופפת את הסטטוס במובייל צר. **תיקון:** הוסרו
מ-AppHeader, הועברו ל-SessionOptionsPanel (disconnect = `session.detach()`+`goto("/")`
ישירות, audio דרך `getSpeaker()` — לא prop drilling). header נקי = 2 פקדים כמו מוקאפ.
**ביקורת חובות מלאה:** מתוך 6 chits בשרשרת — 5 נפדו (SessionOptionsPanel מחווט,
AgentOptionsPanel מוזג+נמחק, FolderPicker מחווט, proof-Lucide הוסר, carMode placeholder
מכוון). רק disconnect+audio נשאר — תוקן כאן.

### B3 — mic-card גולש 682px: flexbox min-w-0 חסר
**שורש:** ה-flex item של עמודת התוכן (AppShell) חסר `min-w-0` → התרחב ל-min-content
(714) במקום להתכווץ ל-390 (flexbox gotcha). `overflow-hidden` חתך ויזואלית אבל המרכוז
חושב לפי 714 → mic גלש שמאלה. **התגלה רק עם session אמיתי** (תוכן עברי ארוך מעלה את
ה-min-content). **תיקון:** `min-w-0` על עמודת התוכן.

### B4 — bubbles+בלוקי קוד גולשים: min-w-0 בשרשרת הבועות
אותו שורש משפחתי כמו B3, בכל רמה. `truncate font-mono` (ToolBubble) ו-inline code
(MessageBubble) דחפו את ה-min-content. **תיקון:** `min-w-0`+`break-words` על 4 הבועות
(wrapper + inner container), `overflow-wrap:anywhere` ל-inline `code`.

### B5 — vh במובייל אמיתי: BottomSheet height מ-vh ל-{sheetPx}px
**שורש (נמדד על CPH2747 דרך Edge+CDP):** `vh`/`lvh`=752 (large viewport, כולל סרגלי
דפדפן) אך `dvh`/`svh`/`innerHeight`=625. ה-sheet `height:80vh` חושב 601px (צריך 500) →
הידית צפה על המיקרופון. **תיקון:** height מ-`{SHEET_VH*100}vh` ל-`{sheetPx}px` (JS
`window.innerHeight` = dvh מדויק ב-Edge Android). `bottom:1098` נשאר מתחת למסך אך לא
מזיק (רק top קובע את ה-peek הנראה).

### UX-1 — RTL: physical → logical classes
האפליקציה כבר RTL (`<html dir="rtl">` + dir attributes קיימים). רק 3 physical classes
נותרו ולא התהפכו: UserBubble `rounded-bl-sm`→`rounded-es-sm`, MessageBubble
`rounded-br-sm`→`rounded-ee-sm`, mic-card logical corners, Switch קיבל `dir="ltr"`
(toggle ויזואלי — חריג שלא מתהפך). `left-1/2 -translate-x-1/2` (centering) נשאר — לא RTL.

### UX-2 — מובייל: fade במקום כרטיס
**מוקאפ:** במובייל אין mic-card — הרקע שטוח וההודעות נמוגות דרך chat-fade. **תיקון:**
class `.mic-plain` (כש-`responsive.isMobile`) מאפס border/radius/shadow/bg של ה-mic-card,
footer מקבל `background:var(--bg)`.

### UX-3 — chat-fade: wrapper סביב הגלילה (תוצר-לוואי של B1)
**שורש:** אחרי B1 (footer הפך sibling), ה-chat-fade (`absolute bottom-0` של העמודה)
נתקע מתחת ל-footer האטום ונעלם → פס חד. **תיקון:** אזור הגלילה עטוף ב-wrapper
`relative flex-1`, ה-fade `bottom-0` בתוכו → נצמד לגבול גלילה/footer (המוקאפ עושה זאת
ב-JS עם `footer.offsetHeight`; אנחנו ב-CSS נקי). JumpDown הוזז `bottom-20`→`bottom-4`.

### UX-4 — BottomSheet: גרירה רציפה + 3 detents
**תוכנית:** sheet בינארי (peek↔open, snap ±30px). **בקשת משתמשת:** גרירה עם האצבע +
לקבוע כמה ייפתח. **תיקון:** UiShellVM קיבל `sheetDetent` ("peek"|"half"|"full") +
`sheetDragPx` (גובה רציף בזמן גרירה), `sheetOpen` הפך getter (peek=סגור, לתאימות
openSheet/closeSheet). BottomSheet: pointermove רציף, pointerup snap ל-detent קרוב,
רקע/opacity interpolated לפי הגובה הגלוי. peek=28px (רק הידית, היה 60px עם תוכן בולט),
grip `w-12 h-1.5` `var(--border-str)` (היה `w-10 h-1` `var(--border)` — כמעט בלתי-נראה).

### UX-5 — מעבר Type↔Record: opacity-crossfade מוערם + רגע ריק
**תוכנית (redesign-4):** `{#if mode}` + `transition:fade` של Svelte → הוספה/הסרה של DOM,
out+in במקביל, reflow → קפיצה. **תיקון (לפי מוקאפ 443-467 שמשתמש ב-`hidden` toggle לא
`{#if}`):** שני panes תמיד ב-DOM, מוערמים באותו תא grid (`grid-row/column:1`), מעבר
ב-opacity+visibility בלבד. **timing:** 0.3s לכל שלב + `transition-delay:0.3s` ל-pane
הנכנס → היוצא דוהה לגמרי, רגע ריק ~300ms (שניהם opacity 0), אז הנכנס עולה. סה"כ ~600ms.

### כלי DEV-only — Mock sessions (flow C, נאמן ל-ACP)
**צורך:** לדבג עיצוב בלי לטעון שיחות אמיתיות (כל loadSession = bridge ~300MB דולף;
ניקינו 11 bridges = 3.4GB). **החלטה — flow C (הכי נאמן, בחירת המשתמשת):** ה-fixtures
הם **ACP updates גולמיים** (לא Bubble[]), וה-mock מזרים אותם דרך **אותו `#onSessionUpdate`**
האמיתי → תופס גם באגי המרה/מיזוג chunks. נדחו flow A (ממלא bubbles ישירות) ו-B (route).
- **חילוץ:** `/tmp/fixtures/extract-raw.py` — מדבר ACP stdio ישירות (`opencode acp`:
  initialize → `session/load` עם **`mcpServers:[]`** חובה → אוסף `session/update`). תהליך
  חד-פעמי, מת מיד — אפס bridges. (נדחו: חילוץ דרך DOM/browser, חילוץ דרך BE endpoint.)
- **אחסון:** `static/fixtures/*.json` (fetch בזמן ריצה, מחוץ ל-bundle). 6 fixtures:
  greeting(5u)/tool-spill/phone-tunnel/mitm(259u)/salary-prev/salary-attendance. tool
  results ארוכים קוצצו ל-~2KB (`[truncated for fixture]`) — 41MB→512KB.
- **הזרקה:** `loadSession` ב-`import.meta.env.DEV` מזהה `mock:<name>` → `#loadMockSession`
  fetch+מזרים. **trigger:** URL `?mock=<name>` (+`&stream=<ms>` ל-delay) דרך `location.search`
  (לא `$page` store — לא מוכן ב-init), או picker (`🧪 MOCK:` מוזרק ב-DEV). `window.__session`
  חשוף ב-DEV. הכל tree-shaken מ-prod.
- **באג שנחשף ותוקן (timing):** הלולאה הסינכרונית דחפה את כל ה-bubbles בבת אחת, וה-`$effect`
  של ה-Speaker רץ רק אחרי שכבר `isLoadingHistory=false` → הקריא הכל ב-TTS. **תיקון:**
  `await tick()` אחרי הלולאה (בעוד `isLoadingHistory=true`) מאלץ flush → replay-quiet עובד.
  (ACP אמיתי לא סובל מזה — updates אסינכרוניים.)

### סטטוס
כל הבאגים תוקנו, typecheck 0, 49 tests, i18n נקי. עדיין **לא merged** — ממתין לאישור
משתמשת. merge יחיד של redesign-7 מביא את כל 1-7 (שרשרת לינארית) + תיקוני הדיבוג.

## 2026-06-02 — redesign-6: Modals — Bits Dialog ✅

### הכרעת Dialog

**Bits Dialog** (bits-ui@2.18.1 — כבר מותקן מ-redesign-3): focus-trap, Esc, click-outside, scroll-lock מובנים.
- בדיקת RTL: Bits Dialog משתמש ב-Portal על `document.body` — עובד ב-RTL (dir לא חשוב ל-Dialog עצמו).
- לא נוצר `ui/Dialog.svelte` wrapper (אין צורך — Bits Dialog משומש ישירות ב-modals).
- אם RTL נשבר > 30 שורות hacks → custom modal (focus-trap ידני), בהתאם ל-§7.

## 2026-06-02 — redesign-3: Settings — Bits Switch + native Select fallback

### הכרעת component-lib

**Switch → Bits UI** (`bits-ui Switch.Root + Switch.Thumb`):
- תומך RTL + a11y מובנה (aria-checked, keyboard, focus-trap)
- עובד עם `.toggle` CSS helper מ-app.css (RTL-safe: `right: 3px` / `right: calc(100% - 23px)`)
- שלוש שכבות disabled: `pointer-events-none` על label, `aria-disabled`, `onCheckedChange={disabled ? undefined : handler}`

**Select → native `<select>` מעוצב בTailwind** (fallback, לא Bits Select):
- Bits Select דורש: Portal + JS overhead + Trigger/Content/Item composition + RTL quirks
- native styled `<select>` — RTL-safe בדפדפן, מינימל, תואם לVoicePicker הקיים
- אשר גם ב-§7 של ה-brief: "fallback native styled select — לגיטימי"
- תועד גם ב-`components/ui/Select.svelte` (comment)

### ממצאי אביגיל (redesign-3)

ר' `reports/voice-acp/slice-redesign-3-settings-avigail.md` — USABLE-AFTER-FIX (2 סבבים). כל findings תוקנו לפני handoff לאליעזר.

### ממצאי calev (redesign-3)

calev light: PARTIAL→GO (2 findings, שניהם תוקנו):
- F1: translateThoughts disabled לוגי — תוקן ב-SettingToggle (aria-disabled + onCheckedChange guard)
- F2: decisions entry — entry זה

## 2026-06-01 — convention: הערות בקוד בעברית

### רציונל
המשתמשת ביקשה במפורש שהערות בקוד (code comments) יהיו **בעברית** — לאורך כל
ה-codebase, לקוד חדש ולהערות אנגלית קיימות כשנוגעים בקובץ. זה תואם את העובדה
שרוב ה-VMs כבר כתובים עם הערות עברית (Mic, Speaker, AgentSession וכו').

### למה זה לא מתנגש עם lint:i18n
ה-`scripts/lint-no-hebrew-in-code.sh` חוסם עברית **ב-runtime strings** (מחרוזות
שמגיעות למשתמש — חייבות לעבור i18n catalog, D10). אבל ה-state machine שלו **מנקה
הערות לפני הסריקה** → הערות עברית מותרות במפורש ועוברות. אין התנגשות בין שתי הדרישות.

### היקף ואופן יישום
~610 שורות הערות אנגלית בקוד (frontend ~265, core ~224, backend ~122). לא מתורגם
במכה אחת — **opportunistic**: כל slice/תיקון שנוגע בקובץ מתרגם את ההערות בו תוך כדי.
הכלל עצמו (התקף, לא הרציונל) נשמר כ-convention; לא נכתב ב-AGENTS.md לפי בקשת המשתמשת.

## 2026-06-01 — slice 9a (speech toggles): ההעדפה ב-Settings, ה-Speaker קורא וקוצר ב-pipeline קיים

### רציונל
שלושת ה-toggles (הקראת מחשבות / קריינות כלים / תרגום מחשבות) הם **העדפות מתמשכות**
→ שייכים ל-`Settings` (entity persisted, לא state חולף). ה-`Speaker` הוא ה-owner של
החלטת "מה להקריא", ולכן הוא **קורא** את ה-flags מ-`this.#settings` בתוך ה-`$effect`
הקיים שלו ומקצר את ה-pipeline (`if (!flag) skip`). אין VM חדש, אין engine חדש, אין
`$effect` חדש — owner-correct לפי חוק זהב #4, ועקבי עם ההערה שהייתה ב-Speaker מ-slice 2
("Slice 9 יחבר אותו דרך Settings").

### החלטה: speech toggles עכשיו (9a), cue toggles אחר כך (9b)
slice 9 המקורי כלל גם "audio cues toggles". פיצלתי: 9a = speech toggles + voice picker
(נשען כולו על קוד merged), 9b = cue toggles (volume/mute) שיבוא **אחרי** slice 6 — כי
ה-`CuesEngine` (שעליו ה-toggle יקשור) עדיין לא merged. אין על מה לקשור toggle שלא קיים.

### תלות UI בין הגדרה 1 ל-3
"תרגום מחשבות" הגיוני רק כש"הקראת מחשבות" דלוקה (אם לא מקריאים — אין מה לתרגם).
ההחלטה (עם המשתמשת): שתי בוליאניות **עצמאיות ב-state** (נשמרות בנפרד), אבל ה-toggle
של התרגום **מנוטרל ויזואלית** ב-UI כשהקראת מחשבות כבויה (`disabled` + עמעום). לא מאפסים
את הערך — חוזר פעיל כשמדליקים שוב הקראה. נקי יותר ל-drive-first מאשר עצמאי-לגמרי.

### עדינות: מתי כל flag נקרא (א-סימטריה מכוונת)
speakThoughts/narrateTools נקראים בזמן **enqueue** (ב-`$effect`, tracked) → סימון
`processedSegments` בדילוג מונע בליעת היסטוריה אחרי הדלקת toggle (עקבי עם טיפול `!enabled`).
translateThoughts נקרא בזמן **fetch** (ב-`#fetchJob`, async, לא tracked) → משפיע על jobs
שמתבצעים מרגע השינוי, לא רטרואקטיבית. אביגיל אישרה ששתי הגישות נכונות.

### ממצאי אביגיל (READY, סבב 1)
brief יוצא-דופן באיכותו. המבחן הקריטי — ה-tip זז מ-56139d7 ל-7859964 אחרי merge של
design-principles — עבר במלואו: כל 13 מספרי השורות ב-Speaker מדויקים. החור שחששתי ממנו
(בליעת thoughts אחרי הדלקת toggle) — אין: ה-skip זהה בדיוק ל-`!enabled` הקיים. finding
יחיד קל: §3 כתב "8 מפתחות" במקום "6" → תוקן.

## 2026-06-01 — slice 25 (bridge leak fix): FE cleanup הורג bridge, לא נוגעים ב-BE

### רציונל
כל מחזור connect→disconnect (וכן reload / שגיאת חיבור) השאיר תהליך CLI יתום וחי
ב-BE לנצח. הסיבה ארכיטקטונית ובכוונה: `ws-agent.ts:126` **לא** הורג את ה-child
בסגירת WS, כדי לאפשר reconnect עתידי (future "agents-ברקע", גישה A). אבל ה-FE
מעולם לא ביקש מחיקה מפורשת. הבחירה: **תיקון עצירת-דימום (גישה B)** — `#cleanup`
ב-`AgentSession` שולח `DELETE /api/agents/:id` (fire-and-forget) לפני איפוס ה-agentId.
שלושת מסלולי ה-cleanup (detach, attach-catch, loadSession-catch) מקבלים את התיקון
בחינם כי כולם עוברים דרך `#cleanup`. **לא נוגעים ב-BE/ws-agent** — התשתית ל-future A
נשארת שלמה; agents-ברקע עם ממשק ניהול הוא slice עתידי נפרד.

### ממצאי אביגיל
- **סבב 1: USABLE-AFTER-FIX.** ה-brief הזהיר שוב-ושוב ש-`lint:i18n` חוסם הערות עברית
  ומורה לאליעזר לתרגם — **הפוך מהמציאות**: ה-lint מנקה את כל ההערות (state machine)
  לפני סריקה, והערות עברית מותרות במפורש (כל ה-VM כבר כתוב בעברית ועובר). אזהרה הפוכה
  שהייתה גורמת לתרגום מיותר / רעש בשאלה פתוחה #3.
- **סבב 2: READY.** האזהרה הוסרה, ה-After נשאר עברית (הנכון), ומספרי השורות סונכרנו
  ל-dev tip חדש (dev התקדם מ-`62b41a0` ל-`7859964` בין הסבבים — slices 22+23 מוזגו;
  `#cleanup` זז מ-~254 ל-335, import מ-16 ל-21). אין מסלול cleanup רביעי; תוספות
  slice 23 (`#detached`, `#captureSessionConfig`) לא מתנגשות.

### רעיונות שנדחו
- **גישה A (agents-ברקע + ממשק)** — נדחתה לעתיד. עצירת הדימום דחופה ופשוטה (6 שורות);
  reconnect-by-session + רשימת agents פעילים זה scope גדול בנפרד.
- **timeout/GC ל-bridges יתומים ב-BE** — נדחה. רשת-ביטחון מיותרת כש-FE מנקה נכון.

## 2026-06-01 — slice 6 (audio cues): owner-driven, אפס $effect

### רציונל
ה-brief המקורי (29/5) הניח ש-slice 3 (VoiceMode) לא merged, ולכן בחר **מנגנון חיצוני**
("Cues VM") שמנחש מתי לנגן cue מתוך `VoiceMode.state` ה-`$derived`, וה-integration נדחה
ל-follow-up. כשחזרנו ל-slice 6 התברר ש-slice 3 כבר ב-dev → ההצדקה לגישה החיצונית
(להישאר additive בזמן מקביליות) נעלמה. שוכתב ל-**owner-driven (חוק זהב #4)**: כל cue
מנוגן ע"י ה-VM שמחזיק את ה-state שעובר transition — Mic (recordingStart/Stop),
Speaker (speaking), AgentSession (thinking/error).

### שינוי-כיוון תוך כדי תכנון: effect → מתודה מפורשת
הגרסה הראשונה של ה-rewrite השתמשה ב-`$effect` לזיהוי transitions (גם ב-Speaker וגם
ב-AgentSession). המשתמשת הטילה ספק: `$effect` הוא reactive-magic פחות יציב ומפורש ממתודה.
צדקה. שונה לשלושה פתרונות מפורשים לפי המבנה של כל VM:
- **Mic** — transition אחד מקומי → קריאה ישירה ב-`toggle()`.
- **Speaker/Player** — Player מקבל `onPlaybackStart?` callback גנרי (לא יודע על cues),
  קורא לו ב-`#playLoop` כש-`state="playing"`. Speaker מספק את ה-callback.
- **AgentSession** — `status` נכתב ב-12 מקומות מפוזרים → **setter מרכז `#setStatus()`**
  שכל ה-writes עוברים דרכו. זה refactor INVASIVE (מאושר: slice 3 merged → אין מקביליות)
  שגם מנקה code smell קיים (12 writes ללא נקודת-mutation אחת).

### החלטה: CuesEngine הוא engine, לא VM
owner של AudioContext ללא `$state` ריאקטיבי — בדיוק כמו Recorder/Player/AudioStream.
ב-FE הזה "engine" = imperative resource owner של הדפדפן (browser-only), לא shared
client/server. ה-shared layer הוא `core/`. Web Audio → client-only → engine.

### ממצאי אביגיל (3 סבבים — דוגמה לערך plan-gate)
- **סבב 1 (USABLE-AFTER-FIX)**: תפסה שה-`#playing` guard ב-Player מונע רק `#playLoop`
  מקבילי, לא re-entry סדרתי. עם LOOKAHEAD=2 ו-fetch אסינכרוני התור מתרוקן בין משפטים →
  cue "speaking" היה חוזר באמצע הדיבור.
- **סבב 2 (NEEDS-REWORK)**: התיקון הראשון שלי (reset של `#spokeThisTurn` ב-`#stopAndClear`)
  הפך את הבאג — `#stopAndClear` לא רץ בסוף תור רגיל (רק toggle-off/cancel/destroy), אז
  הדגל נשאר `true` וה-cue נבלע מתור 2 ואילך. אביגיל הצביעה על נקודת ה-reset הנכונה.
- **סבב 3 (READY)**: reset עבר ל-`#handleStatusTransition` על מעבר `→ thinking` (תחילת תור),
  שרץ לפני עדכון `#prevStatus`. reset-on-turn-start עדיף על reset-on-turn-end (נקודה אחת
  ודאית מול זיהוי כל מסלולי הסיום כולל error).

### החלטות-משנה לעתיד
- ההבחנה primary/derived VMs לא מיושמת (derived/ עם דייר אחד — VoiceMode). נשארת פתוחה.
- עלה צורך במסמך `design-principles.md` מרכז + סטנדרט reactivity ($effect מתי/לא) +
  סטנדרט state-machine (`#setStatus`-style). מתוכנן כ-session נפרד (consolidation + review).

## 2026-06-01 — refactor: מקור-אמת אחד ל-CLIs

### רציונל
היו 3 מקורות חופפים ולא-מסונכרנים לרשימת ה-CLIs: `BridgeKind` (core/ports, 5 סוגים),
`CliKind` (core/schemas, 4 — בלי qoder), ו-bin/args (backend). תוצאה: qoder היה ב-types
וב-bin אבל לא ב-FE dropdown ולא ב-schema; וב-cli-config היה dead-code switch אחרי return.
אוחד הכל לרשומה אחת `CLI_SPECS` ב-core/schemas/agent.ts — שם + bin/args + supportsModelFlag
באותו מקום. כל השאר (CLI_KINDS, CliKind arktype, BridgeKind alias, FE dropdown) נגזר.

### ההכרעה הארכיטקטונית
**bin/args יושבים ב-core למרות ש-spawn הוא IO** — כי bin/args הם נתונים סטטיים (מחרוזות),
לא IO בעצמם; ה-IO (spawn) חי ב-backend. ההפרדה: *הגדרה* (סטטית) → core; *resolution*
תלוי-סביבה (OPENCODE_BIN מ-process.env, הוספת --model) → backend (shell). זה לא מפר את
"no IO in core" כי core רק מחזיק מחרוזות.

### באג שנחשף
`OPENCODE_BIN` נקרא במקור eager (בזמן טעינת המודול) → טסט שמגדיר env אחרי טעינה נכשל.
תוקן ל-lazy (בזמן getCliCommand). תואם את ה-service file (OPENCODE_BIN=opencode-clean.sh).

### טסטים מיושנים שתוקנו
3 טסטי gemini ציפו ל-`npx @google/gemini-cli --experimental-acp`. אומת מול ה-binary
המותקן (~/.vite-plus/bin/gemini): הפקודה הנכונה היא `gemini --acp`, ו-`--experimental-acp`
deprecated ("use --acp instead"). הקוד היה נכון, הטסט מיושן — יושר למציאות.

## 2026-06-01 — slice-26: Temporary Bridge Idle-Reaper (BE)

### ‏רציונל
‏slice 25 (FE cleanup) ‏לא מכסה מקרה אחד: ‏**‏reload סתמי / ‏טאב שנסגר** ‏— ‏שם ה-FE ‏מת בלי ש-`#cleanup` ‏רץ, ‏וה-bridge ‏נשאר יתום. ‏לפי בקשת המשתמשת הוספנו **‏רשת-ביטחון זמנית בצד שרת**: ‏reaper תקופתי שהורג bridges ‏ללא WS ‏מחובר אחרי timeout (‏ברירת מחדל 5min, `BRIDGE_IDLE_TIMEOUT_MS`).

‏ההחלטה הקריטית בעיצוב: ‏**‏מדד ה-idle ‏הוא "זמן מאז ניתוק ה-WS ‏האחרון", ‏לא "מאז יצירה" ‏ולא "מאז פעילות"**. ‏הסיבה — ‏ה-BE ‏משאיר bridges חיים בכוונה (`ws-agent.ts:126`) ‏כדי לאפשר reconnect ‏(future A). ‏מדד מבוסס-יצירה היה הורג גם סוכן שרץ משימה ארוכה ‏וגם סוכן שמחכה ל-reconnect לגיטימי. ‏הכלל: ‏`hasActiveWs===true` → ‏**‏לעולם לא נאסף**. ‏זה גם תואם-קדימה ל-future A (‏reconnect ‏בתוך החלון "מנצל" ‏את הסוכן ‏ומאפס את הטיימר).

‏grace period פי-2 ‏לסוכן שמעולם לא נפתח לו WS — ‏מגן מפני race ‏בין `createAgent` ל-WS open ‏(לא להרוג סוכן בן-שנייה שעומד להתחבר).

‏ה-reaper ‏קורא ל-`orchestrator.deleteAndKill` ‏(נתיב מאוחד: ‏kill + ‏registry.delete), ‏לא ל-`bridgeManager.kill` ‏ישירות — ‏אחרת `/api/agents` ‏היה מציג סוכן מת.

### ‏זמניות (‏קריטי)
‏זה סלייס **‏זמני**. ‏כל הקוד מתויג `// TEMPORARY (slice 26)` ‏ויש §7 ‏עם תנאי-מחיקה מפורש (`grep -rn "TEMPORARY (slice 26)"`). ‏יימחק כשייכנס מנגנון ניהול agents-ברקע מסודר (future A) ‏שיחליף את ה-reaper ‏ב-lifecycle ‏מנוהל (‏reconnect מפורש + ‏רשימת agents + ‏סגירה יזומה).

### ‏ממצאי אביגיל
‏Verdict: READY (‏ללא תיקון מהותי). ‏כל 8 ‏נקודות האימות עברו: ‏מספרי שורות מדויקים, ‏לוגיקת `listIdle` ‏ללא חור, `reaper.unref()` ‏תקף, `deleteAndKill` ‏מנקה registry, ‏race ‏מטופל סבירות. ‏2 ‏ממצאי minor: ‏(1) ‏הבהרה ש-server.ts ‏אין בו shutdown handler → `unref()` ‏מספיק (‏תוקן); ‏(2) ‏פקודת `bun --watch` ‏ידנית בעוד ה-BE ‏רץ Node — ‏לא משפיע.

### ‏רעיונות שנדחו
- ‏**‏מדד idle מבוסס "מאז יצירה" ‏או "מאז פעילות אחרונה"** — ‏יהרוג סוכנים פעילים. ‏נדחה לטובת "מאז ניתוק WS".
- ‏**‏shutdown handler ‏עם clearInterval** — ‏מיותר; `unref()` ‏מספיק ‏ו-server.ts ‏ממילא אין בו graceful shutdown ‏היום.

---

## 2026-06-01 — slice-25: Bridge Process Leak Fix

### ‏רציונל
‏אבחון מצא דליפת תהליכים: ‏כל מחזור connect→disconnect/reload/error ‏משאיר תהליך CLI ‏(opencode/claude/gemini) ‏יתום וחי ב-BE ‏לנצח. ‏שורש הבעיה — ‏עיצוב חצי-גמור: ‏ה-BE ‏בכוונה לא הורג את ה-child ‏בסגירת WS (`ws-agent.ts:126`, ‏כדי לאפשר reconnect עתידי), ‏אבל הצד השני של הגשר מעולם לא חובר: ‏ה-FE ‏לא קורא ל-`deleteAgent` ‏ב-`#cleanup`/`detach`, ‏ולא מבצע reconnect אמיתי (‏מנגנון הדה-דופ ‏בצד שרת מנותק כי ה-FE ‏לא שולח `existingSessionId`).

‏בחרנו **‏גישה B ‏(תיקון מיידי)**: ‏`#cleanup` ‏קורא `deleteAgent(agentId)` ‏כ-fire-and-forget → ‏ה-BE ‏הורג את ה-bridge (SIGTERM→SIGKILL). ‏שורה אחת, ‏סיכון נמוך, ‏עוצר את הדימום. ‏מסלול רשימת הסשנים (`listSessionsForCwd`) ‏כבר נקי (spawn→delete מסודר) — ‏לא נגענו בו.

‏**‏גישה A ‏(reconnect אמיתי + ‏agents-ברקע) ‏נדחתה לסלייס עתידי** ‏לפי החלטת המשתמשת: ‏היא רוצה מנגנון שמשאיר סוכנים חיים ברקע (‏ממשיכים לרוץ גם כשהחלון נסגר), ‏עם ממשק ניהול לראות/לסגור agents פעילים. ‏זה דורש תכנון UX + ‏חיווט `existingSessionId` + ‏רשימת agents — ‏לא תיקון-דחוף. ‏לכן הפרדנו: B ‏עכשיו, A ‏כסלייס מתוכנן.

### ‏ממצאי אביגיל
‏Verdict: USABLE-AFTER-FIX (‏אין blocker). ‏כל הסמלים, ‏מספרי השורות, ‏וה-import אומתו מדויקים; ‏אין מסלול cleanup שלישי שעוקף את התיקון; `depends_on=[]`/`base=dev` ‏נכונים. ‏הבעיה היחידה: ‏האזהרה שלי על `lint:i18n` ‏הייתה **‏הפוכה** — ‏טענתי שה-lint ‏עלול לחסום עברית בהערות, ‏אבל ה-state machine ‏מנקה הערות לפני סריקה (‏וכל הקובץ כבר כתוב בהערות עברית). ‏תוקן: ‏הוסרה הוראת התרגום המיותרת ‏מ-§5/§6/§9.

### ‏שינויי-כיוון
‏אין — ‏רק תיקון תיעוד פנימי ב-brief. ‏הליבה (‏גישה B, ‏שורה אחת ב-`#cleanup`) ‏נשארה.

### ‏רעיונות שנדחו
- ‏**‏timeout/GC ‏ל-bridges יתומים בצד BE** — ‏רשת-ביטחון; ‏לא נדרש כש-FE ‏מנקה. future.
- ‏**‏שינוי `ws-agent.ts` ‏שיהרוג child ‏ב-WS close** — ‏היה הורס את התשתית ל-future A (agents-ברקע). ‏השארנו את "child שורד WS close" ‏שלם.

---

## 2026-05-31 — slice-6: Audio Cues engine

### ‏רציונל
‏הוספת חיווי קולי (cues) חיונית לחוויית drive-first כדי לאפשר למשתמשת לדעת מתי המערכת מקשיבה, חושבת או מדברת מבלי להביט במסך. בחרנו במימוש מבוסס Web Audio API (oscillators) ולא קבצי אודיו כדי לשמור על גמישות בתדרים, זמני טעינה אפסיים ומינימום bundle size.

### ‏ממצאי אביגיל
‏אביגיל זיהתה שתי בעיות קריטיות במימוש ה-Web Audio:
1. ‏העדר `setValueAtTime` לפני `linearRampToValueAtTime` ב-glides, מה שהיה גורם לצלילים להתחיל מתדר ברירת המחדל.
2. ‏צורך ב-`AudioContext.resume()` כדי להתמודד עם Autoplay Policy של Chrome גם בתוך user gesture.

### ‏שינויי-כיוון
‏ה-brief עודכן לכלול את התיקונים הטכניים שאביגיל הציעה. בנוסף, הובהר שהפרויקט מתבסס על `dev` שכבר כולל את מבנה Slice 3.

---

## 2026-06-01 — slice-23: Agent Options Panel

### ‏רציונל
‏בחרנו להוסיף ווידג'ט אפשרויות סוכן שמבוסס כולו על ACP `session/set_config_option` — לא דרך CLI flags ולא דרך discovery session זמני. הסיבה: `opencode acp` לא מקבל `--model`/`--agent`; session זמני ישאיר סשנים יתומים. ה-ACP מחזיר `configOptions/models/modes` מיד אחרי `session/new` — זה מספיק להחלת בחירות.

‏עיצוב cache: אפשרויות נשמרות לפי `cliKind|normalizedCwd` ב-localStorage, כך שמהחיבור השני dropdowns אמיתיים מופיעים לפני פתיחת הסשן.

### ‏ממצאי אביגיל (round 2 — NO-GO, round 3 — PASS)
‏4 blockers שזוהו ב-round 2:
1. ‏`SetSessionConfigOptionRequest` הוא discriminated union — boolean דורש `{ type:"boolean", value }`. תוקן ב-Commit 1.
2. ‏`models/modes` נשמרים ב-snapshot אך לא שימשו לרנדרינג; agents שמחזירים `models` בלי `configOptions` מתאים לא קיבלו dropdown. תוקן ב-rendering rules (3 מסלולים: `snapshot.models`, `configOptions.category`, fallback ידני).
3. ‏זיהוי model/mode לפי `id === "model"` שגוי — `id` הוא arbitrary. תוקן לשימוש ב-`category === "model"/"mode"`.
4. ‏`throw` על option חסר היה חוסם מעבר בין פרויקטים. תוקן ל-`console.warn` + skip.

### ‏שינויי-כיוון
- ‏`#applyConfigSelection` כולל עכשיו 3 מסלולים: `optionById` → `optionByCategory` → fallback method.
- ‏Cache key מנורמל (`.replace(/\/+$/, "")`) כדי לתאים ל-BE `validateCwd`.

### ‏רעיונות שנדחו
- ‏Discovery session זמני: נדחה — יוצר סשנים יתומים בגלל שOpenCode לא מפרסם `session/close`.
- ‏MCP servers / Additional directories בווידג'ט: נדחו ל-slice עתידי; לא מוסיפים מורכבות ל-MVP.

## 2026-06-01 — slice-24: Client-Keyed Proxy Cache

### ‏רציונל
‏ה-proxy-cache ‏ממפתח ‏לפי `sha256(method|path|body)`. ‏זה ‏שובר ‏ל-narrate ‏כי ‏ה-prompt
‏כולל `recentMessages` ‏תלוי-זמן → ‏אותו ‏tool-call ‏מקבל ‏hash ‏שונה ‏ב-reload → cache miss →
‏Gemini ‏מנוסח ‏מחדש → ‏נרטיב ‏**‏שונה** (LLM ‏לא-דטרמיניסטי). ‏הפתרון: ‏ה-FE ‏(‏הצד ‏היחיד ‏שיודע
‏את ה-identity ‏היציב) ‏קובע ‏את ‏מפתח-הקאש ‏דרך ‏header `x-cache-key`, ‏ולא ‏ה-BE ‏מהגוף.

‏**‏אין persistence ‏חדש** — ‏הקאש ‏הקיים ‏(disk) ‏הוא ‏ה-"DB". ‏המפתח ‏הדטרמיניסטי ‏מאפשר
‏re-fetch ‏ב-reload ‏ללא ‏שמירה ‏נוספת ‏מעבר ‏לטקסט ‏הגולמי ‏(‏שמשוחזר ‏ע"י ‏opencode ‏ב-session/load).

‏מפתחות: narrate=`narrate:<toolCallId>`, translate=`translate:<sha256(text+lang)>`,
‏tts=`tts:<voiceId>:<sha256(text+model)>`. ‏הסיבה ‏ש-narrate ‏שונה: ‏ה-input ‏שלו ‏(prompt+context)
‏לא-יציב, ‏אבל `toolCallId` ‏יציב; ‏ב-translate/tts ‏ההפך — ‏ה-input (text) ‏יציב, ‏אבל messageId ‏לא.

### ‏ממצאי אימות (‏בריצה ‏חיה, opencode 1.15.13)
- opencode ‏שולח `messageId` ‏גם ‏בזמן ‏חי (24/24 chunks, ‏UUID ‏יציב), ‏**‏משותף** ‏ל-thought+message
  ‏של ‏אותו ‏turn. ‏לכן messageId ‏לבדו ‏לא ‏מבחין ‏בין ‏סגמנטים → ‏לא ‏יכול ‏להיות ‏מפתח ‏יחיד.
- ‏ה-tool ‏ID (`toolu_...`, ‏ממרחב Anthropic) ‏**‏נפרד ‏לגמרי** ‏מ-messageId. ‏ל-`ToolCall` ‏schema
  ‏אין ‏בכלל ‏שדה ‏messageId.
- `messageId` ‏מסומן ‏**UNSTABLE** ‏ב-ACP spec ‏ו-**‏אופציונלי** (`required: ["content"]`) → ‏לבנות
  ‏עליו ‏מפתח ‏= ‏חול. ‏לכן ‏הוא ‏metadata ‏best-effort ‏בלבד, ‏אף ‏פעם ‏לא ‏במפתח.

### ‏ממצאי אביגיל
- ‏סבב 1: USABLE-AFTER-FIX — blocker: ה-brief ‏ציטט `sha256Key` ‏ב-`core/voice/cache-key.ts`,
  ‏אבל ‏שם ‏יש ‏רק `cacheKeyFor` (‏חתימה ‏אחרת); ‏הגנרי ‏יושב ‏ב-backend (‏ה-FE ‏לא ‏יכול ‏לייבא).
- ‏תיקון: Commit 0.5 ‏מעביר `sha256Key` ‏ל-core (additive). ‏סבב 2: READY.

### ‏רעיונות שנדחו
- ‏BE persistence (index ‏שמקשר session+message→audio): ‏נדחה — ‏שובר D8, ‏ומיותר ‏כי ‏ה-hash
  ‏הדטרמיניסטי ‏מספיק. ‏המשתמשת ‏זיהתה ‏נכון: "‏כמו ‏שבפעם ‏הראשונה ‏נוצר ‏ה-hash, ‏אפשר ‏לחשב ‏מחדש".
- ‏cache סמנטי ב-localStorage ‏(FE): ‏נדחה ‏לטובת `x-cache-key` header — ‏שומר ‏את ‏הקאש ‏במקום ‏אחד (BE disk),
  ‏בלי persistence ‏כפול.
- ‏מחיקת ‏query layer / index ‏לפי messageId: ‏נדחה (YAGNI) — ‏ה-metadata ‏נשמר, ‏אבל ‏ה-query ‏יבוא ‏עם ‏פיצ'ר ‏אמיתי.
- ‏"‏החזרת ‏קריאות ‏ל-BE" (‏במקום FE): ‏נשקל ‏ונדחה ‏לעת ‏עתה — ‏שובר ‏את slice 10, ‏מחזיר 600+ ‏שורות ‏ל-BE.
  ‏נשמר ‏כתוכנית-מגירה ‏אם `@ai-sdk/google` header passthrough ‏ייכשל ‏ב-Commit 0.
