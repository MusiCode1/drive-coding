# Decisions — voice-acp

## 2026-06-02 — slice review-fixes-2: timeout בכל ה-FE adapters (sequel ל-helper)

### רציונל
אחרי ש-review-fixes-1 הוסיף את `withTimeout`, סרקנו את כל הקוד למקומות שצריכים timeout.
מצאנו: agents-api (createAgent/notifySessionAttached/deleteAgent — 0 timeout), voices+tts
(F7 — picker/TTS נתקעים), narrate (timeout ידני — כפילות). מחילים את ה-helper על כולם.

### היקף — מה בפנים ומה בחוץ
**בחוץ במכוון**: (א) **BE proxy streaming** (`http-proxy.ts`) — timeout על stream הוא
בעיה שונה (connect-vs-stream), סבב נפרד. (ב) **getAgent** — אין לו צרכן בקוד (grep);
החלטת המשתמשת: לא לגעת, רק הערת TODO שמפנה תשומת לב. לא לתקן F4 כאן.

### הנקודה העדינה — tts connect-timeout בלי לקטוע streaming
`synthesizeStreaming` מחזיר ReadableStream. `fetch()` resolve על קבלת ה-headers (לפני
צריכת הגוף), אז `withTimeout` עוטף רק את ה-connect+first-response; ה-stream שמוחזר נצרך
אחרי שה-helper הסתיים והטיימר נוקה → הזרמת אודיו ארוכה לא נקטעת. אביגיל אישרה טכנית.

### שרשור
depends_on=[slice-review-fixes-1]. base = branch slice-review-fixes-1 (לא dev, ה-helper
עוד לא merged). סדר merge: review-fixes-1 → dev, ואז review-fixes-2 → dev.

### ממצאי אביגיל
READY סבב 1 (נדיר). 2 minors 🟢: caller שלישי של createAgent (sessions.ts:42 — signal
additive בטוח), narrate block 32-51 (לא 32-54). שניהם תוקנו.

## 2026-06-02 — slice review-fixes-1: F1+F3 (לא T6), ו-Promise.race ל-transcribe

### רציונל
מתוך ה-code review (2026-06-01) בחרנו לאגד 3 באגים ל-slice "review-fixes" אחד.
אחרי חקירה — **T6 (cache-key sanitization) ירד**: הוא כבר מומש ומחווט בתוך slice 24
(`sanitizeCacheKey` = sha256 ב-proxy-cache.ts:63, נקרא ב-http-proxy.ts:97). ה-review
נכתב על tip 115419d, לפני שהקוד הזה נכתב. נשארו F1+F3 — שניהם FE, קצרים, depends_on=[].

### ההכרעה הקריטית — `withTimeout` helper ב-core (לא inline Promise.race)
בתחילה תכננו Promise.race inline בתוך transcribe. המשתמשת שאלה אם עדיף helper משותף —
ובדיקה הראתה 3+ צרכנים (F3 transcribe, F7 voices+tts, ו-translate שעושה ידנית) → abstraction
מוצדק. נכתב `withTimeout(fn, ms, opts?)` ב-`core/src/async/with-timeout.ts` (export חדש `/async/*`).

**הסמנטיקה**: ה-helper **תמיד** עושה `Promise.race` (משחרר את ה-await ללא תלות ב-SDK)
**וגם** תמיד מספק `AbortSignal` (ביטול-רשת אמיתי כש-SDK תומך, כמו ה-`ai` SDK של translate).
שני העולמות בפונקציה אחת — הקורא בוחר אם להעביר את ה-signal ל-SDK שלו.

**שני מלכודות שה-helper מטפל בהן מפורשות** (המשתמשת זיהתה את הראשונה):
- **unhandled rejection**: כשה-timeout מנצח, הצד המפסיד (ה-fn) עלול לדחות מאוחר (AbortError)
  כשאף אחד כבר לא עושה לו await → `void work.catch(()=>{})` בולע (בלי לגזול מהקורא — ה-reference
  המקורי עדיין ב-race).
- **timer leak**: `clearTimeout` ב-finally לכל כיוון. כש-work מנצח → ה-timeout Promise נשאר
  pending לנצח (לא reject) → GC, לא unhandled.

**למה helper ולא 4 inline copies**: בדיוק 2 המלכודות האלה קל לשכוח בהעתקה ידנית (כמו שראינו
ב-slice 26 עם mock לא מעודכן). פונקציה אחת מטופלת-היטב + טסטים = מקור-אמת יחיד.

מבנה: Commit 0 helper (TDD, כולל טסט no-unhandled-rejection ו-timer-cleanup), Commit 1 F3,
Commit 2 F1, Commit 3 יישור translate.ts ל-helper. T6 ירד (כבר ב-slice 24).

### ממצאי אביגיל
סבב 1: USABLE-AFTER-FIX, 4 findings. הקריטי (1+2): ה-brief נתן לאליעזר **שתי גישות
סותרות** (abortSignal-only ב-§4/§6/DoD מול Promise.race ב-§9), וה-brief עצמו הודה
ש-abortSignal-only עלול לא לתקן את הבאג. תוקן ע"י בחירת Promise.race וסנכרון כל הסעיפים.
minors: line numbers של mic.svelte.ts הם reference (slice 6 עשוי להזיז), טענת "טסטים
negative" ל-T6 לא אומתה (הוסרה). סבב 2: **READY** (1 minor — ASCII diagram stale, תוקן).

### שינויי-כיוון
F3 timeout שונה מהתקן-זהב translate.ts ב-2 דברים מתועדים: (א) Promise.race ולא
abortSignal-only, (ב) זורק ולא מחזיר null (כי ה-Mic VM כבר תופס ב-catch).

### רעיונות שנדחו
abortSignal-only (כמו translate) — נדחה כי ה-SDK לא מבטיח שמכבד אותו → לא עמיד.

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
