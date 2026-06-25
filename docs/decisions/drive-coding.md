# Decisions — drive-coding

## 2026-06-25 — slice-session-title-header: כותרת הסשן בהדר הצ'אט

### רציונל
פריט "גל ראשון quick-win" מה-Message&Input UX backlog. ה-`title` כבר קיים ב-`SessionInfo`
(מ-`listSessionsForCwd`) ומוצג ב-`SessionPicker`/`SessionCard`, אבל **לא** חווט ל-`AgentSession`
הפעיל → לא נראה בהדר ה-`/chat` (שמציג placeholder קבוע `"drive-coding"`). תיקון: שדה
`$state sessionTitle` חדש ב-VM, חיווט מ-connect, ו-`AppHeader` מציג עם fallback ל-placeholder
הקיים (אפס regression לסשן חדש). **auto-generate (`generate_session_title`) מחוץ ל-scope** —
future נפרד; הכותרת היא snapshot מרגע הטעינה, ללא תלות ב-wire (זה מה שהפך אותו מ-spike לסלייס קטן).

### שינויי-כיוון — אביגיל הצילה מ-regression שקט
ה-brief הראשון חיווט **רק** את `loadSession`, עם סמנטיקת `sessionTitle = input.title ?? ""`.
אביגיל (r1, USABLE-AFTER-FIX) תפסה שזה משאיר שני נתיבי-כניסה חיים שמאפסים את הכותרת בשקט
(לא נתפס ב-typecheck, כנראה גם לא ב-calev light):
1. **`switchSession`** — הנתיב ה**ראשי** להחלפת סשן בצ'אט (מ-`SessionOptionsPanel`), לא חווט כלל.
2. **`#coldReconnect`** — קורא `loadSession` בלי title → כל WS-reconnect היה מוחק את הכותרת.

ההכרעה המתקנת: **keep-on-undefined** — `sessionTitle = input.title ?? this.sessionTitle`.
קורא שלא יודע title (reconnect) **שומר** במקום למחוק (תיקון אוטומטי, אפס שינוי ב-`#coldReconnect`);
רק נתיבים שיודעים title-חדש (connect/switch) מעבירים `string` מפורש (גם `""` כדי לנקות כראוי
בהחלפה לסשן חסר-כותרת); רק `newSession` מאפס. r2=READY.

### רעיונות שנדחו
- **שדה פרטי `#sessionTitle` שמשוחזר ב-reconnect** (הצעת אביגיל א'): מיותר — keep-on-undefined
  על השדה הציבורי מספיק ופשוט יותר (אין כפילות state).
- **צמצום scope ("warm-switch+reconnect לא בסבב")** (הצעת אביגיל ב'): נדחה — warm-switch הוא
  הנתיב הנפוץ; כותרת שנעלמת בהחלפת-סשן = בדיוק החוויה השבורה שהפריט בא לתקן.
- **fallback ל-"סשן חדש"**: ברירת-המחדל היא שימור ה-placeholder הקיים (`"drive-coding"`) — אפס
  regression, אפס i18n חדש. נשאר כשאלה פתוחה לא-חוסמת (§9) למשתמשת.

## 2026-06-25 — slice-display-toggle-consistency: פולריות אחידה למחווני "תצוגת צ'אט"

### רציונל
המשתמשת תפסה חוסר-עקביות: בכרטיס "Chat display" (מ-chat-render-polish) מחוון אחד
("Collapse thoughts" — ON מסתיר) ואחר ("Expand tools" — ON מציג) בעלי **פולריות הפוכה**.
באותו כרטיס, הפעלת מתג אחד מסתירה ואחרת מציגה — מודל מנטלי שבור. אומת בקוד:
`ThoughtBubble:34` = `open = !collapseThoughts` (שלילי); `ToolBubble:30` = `open = expandTools`
(חיובי). השורש: ב-chat-render-polish כל מתג נוסח כ-"opt-in לשינוי מברירת-המחדל" (מחשבות
פתוחות, כלים סגורים) → פולריות לא-עקבית כתוצר-לוואי.

**ההכרעה**: לאחד לפולריות חיובית אחת — `showThoughts`/`showTools`, **ON תמיד מציג**.
ההתנהגות-בפועל של ברירות-המחדל נשמרת (`showThoughts:true`=מחשבות מוצגות,
`showTools:false`=כלים מצומצמים) — רק המודל המנטלי נעשה עקבי. **migration ב-`load()`**
ממפה מפתחות ישנים (`!collapseThoughts`→`showThoughts`, `expandTools`→`showTools`) כדי
שמשתמשים קיימים לא יאבדו העדפה.

### ממצאי אביגיל
verdict=**READY** (0 חוסמים, 2 findings). 🟡: מספרי שורות ה-reset (178-179) נכונים
ל-dev הנוכחי, אך אם enter-toggle מוזג קודם — שורת `setEnterToSend` נכנסת ביניהן והמספרים
זזים; חודד ב-§4 (אתר ע"י grep, לא מספרים). 🟢: ה-spread ב-`load()` נושא מפתחות-ישנים
ל-runtime — מאושר ב-brief (נופלים בשמירה הבאה). אומת: ה-rename מלא (grep=0), לוגיקת
migration נכונה, snap-back נשמר (`$state` מקומי, לא reactive). דוח:
`reports/drive-coding/slice-display-toggle-consistency-avigail.md`.

### שינויי-כיוון / merge-ordering
- **תלות-מיזוג ב-enter-toggle** (GO, טרם מוזג): שני ה-slices נוגעים בכרטיס + reset.
  הכרעה פתוחה (§9 Q1): למזג enter-toggle קודם (לינארי, נקי) **או** לשרשר slice זה עליו.
  ממתין להכרעת המשתמשת לפני dispatch.

### רעיונות שנדחו
- **לא לגעת (known issue בלבד)** — נדחה; המשתמשת ביקשה עקביות מפורשות, וזה מחמיר עם
  המתג השלישי (enterToSend) שנכנס לאותו כרטיס.
- **להפוך את `expandTools` לשלילי** (כדי "להתאים" ל-collapse) — נדחה; חיובי ("Show")
  הוא המודל הברור; הפכנו את `collapseThoughts` אליו, לא להפך.
- **בלי migration** (ערך ישן נופל ל-default) — נדחה; זול לשמר העדפה (2 תנאים ב-load).

## 2026-06-25 — slice-latex-math: רינדור LaTeX/KaTeX עם allowlist פר-מקור

### רציונל
רינדור נוסחאות (KaTeX) בכל 4 הסגנונות (`$`,`$$`,`\(`,`\[`). ההכרעה המרכזית — **אבטחה**:
KaTeX מייצר HTML עם inline `style` (positioning), שמנוגד ל-policy שאסר `style` ב-DOMPurify
(vector ל-CSS-injection). הפתרון הסופי: **allowlist פר-מקור (two-pass)**, לא רשימה כללית אחת.

- **המנגנון**: extension פנימי (`marked.use`) שמזהה math (מכבד code blocks דרך ה-pipeline,
  לא regex) ומפיק **placeholder**; `renderMarkdown` עושה two-pass: ה-markdown עובר
  `MARKDOWN_ALLOW` (שמרני, **בלי span/style**), וכל KaTeX עובר `KATEX_ALLOW` (נדיב: span/style/
  MathML/SVG) **בנפרד**, ואז מוזרק. ה-`span`+`style` קיימים אך-ורק במסלול KaTeX (input מהימן:
  generated, `trust:false`). span גולמי של מודל-מתחזה (prompt-injection) → נמחק.
- **secure by construction, לא by filtering**: לא "מסננים" CSS מסוכן (ומקווים שה-allowlist מושלם)
  — פשוט לא יוצרים את ההרשאה במסלול הלא-מהימן.

### ממצאי אביגיל (3 סבבים — אומת אמפירית, לא בהנחה)
- **r1 = NEEDS-REWORK**: ההכרעה המקורית ("התר `style` גלובלי כי DOMPurify מסנן `url()`/`javascript:`")
  הייתה **שגויה עובדתית** — אביגיל הריצה DOMPurify ואימתה ש-style עובר verbatim. **טעות של מרדכי**;
  אביגיל תפסה לפני קוד. (הסיכון האמיתי: overlay-phishing/exfiltration דרך prompt-injection, **לא** RCE — מת ב-2026.)
- **r2 = USABLE-AFTER-FIX**: ה-two-pass אומת אמפירית — כל 5 ההנחות (בידוד span-strip, re-inject ≠ modify-after,
  PUA sentinel שורד, marked-extension API, map per-call). נותרו 3 דיוקים.
- **r3 = USABLE-AFTER-FIX + אישור-מותנה**: KATEX_ALLOW הושלם (mtable/sum/vector...), אומת שאין tag מסוכן.
  4 ערכי-MathML שוליים (`mpadded`/`linethickness`/...) נוספו → READY.

### שינויי-כיוון
- מ"התר style גלובלי + סנן" (r1) → "allowlist פר-מקור, style מבודד ל-KaTeX" (r2+). תובנת המשתמשת:
  ה-CSS המסוכן מגיע מ-HTML-גולמי-של-מודל, לא מ-KaTeX/LaTeX → לבנות כך שלא קיים, לא לסנן.
- `marked-katex-extension` הוסר — extension פנימי שולט בכל ה-delimiters (פותר גם `\(`/`\[`).

### רעיונות שנדחו
- **`style` גלובלי + DOMPurify** — שגוי (style עובר verbatim).
- **placeholder re-inject בלי sanitize נפרד** — מפר אזהרת DOMPurify "modify-after".
- **MathML-only** — בטוח-מבנית ופשוט יותר, אך KaTeX-HTML מלוטש יותר; נבחר two-pass לטובת ה-rendering.
- **CSS-sanitizer hook (uponSanitizeAttribute)** — תקף (המלצת DOMPurify), אך per-input בטוח-מבנית יותר (לא תלוי בשלמות allowlist של CSS-properties).

## 2026-06-24 — slice-enter-toggle: ביטול שליחה ב-Enter (toggle)

### רציונל
ראשון ב-"Message & Input UX backlog" (Track C, נקלט מהתנסות המשתמשת). נבחר כ-quick-win
ראשון כי כל התשתית קיימת: ה-handler ב-`TypeArea` כבר מבחין Enter/Shift+Enter, ותשתית
ה-settings (Persisted + reset) קיימת מ-chat-render-polish. השדה `enterToSend` ברירת-מחדל
`true` → **התנהגות נוכחית נשמרת**, אין הפתעה למשתמש קיים. כש-off: Enter=שורה-חדשה, שליחה
בכפתור (תמיד קיים — ידידותי-נייד) או Cmd/Ctrl+Enter. Cmd/Ctrl+Enter שולח בשני המצבים
(power-user עקבי).

**הכרעת depends_on**: התבסס על `chat-render-polish` (לא dev הנקי) — הוא מוסיף את כרטיס
"תצוגת צ'אט" ב-SettingsScreen + דפוס Persisted ל-toggles, וה-toggle החדש נכנס לאותו כרטיס.
base = dev אחרי merge של chat-render-polish. **חוסם dispatch**: chat-render-polish חייב
להתמזג ל-dev ראשון.

### ממצאי אביגיל
verdict=**READY** (0 חוסמים, 2 findings ירוקים). #1: הפניה קוסמטית — `en.ts:196` היא
שורת-הערה (expandTools ב-197-199); הוראת-ההוספה עצמה נכונה — תוקן ה-ref. #2: ל-keydown
החדש אין guard ל-`e.isComposing`/IME — אבל גם ל-baseline אין, אז זו **לא רגרסיה** שה-brief
מכניס (קיים-מראש, מחוץ ל-scope). אומת שקריאת `settings.enterToSend` בתוך event-handler
אינה בעיית reactivity של Svelte 5 (קריאת-ערך, לא render). דוח: `reports/drive-coding/slice-enter-toggle-avigail.md`.

### רעיונות שנדחו
- **כרטיס "קלט" נפרד ב-settings** — נדחה; ה-toggle שייך-לוגית לתצוגת-הצ'אט, חוסך כרטיס.
- **לשנות Enter ל-newline ללא הגדרה (swap קשיח)** — נדחה; שובר ציפייה של משתמשים קיימים.
  toggle עם default=current שומר תאימות-לאחור.
- **IME isComposing guard** — לא נכלל בסבב (out-of-scope, pre-existing); מועמד ל-polish עתידי.

## 2026-06-24 — slice-chat-render-polish: טבלאות MD + תמונות בכלים + העדפות-תצוגה

### רציונל
שלושה שיפורי-רינדור בצ'אט אוחדו ל-**brief אחד עם 3 commits עצמאיים** (לא 3 slices נפרדים).
הסיבה: שלושתם נוגעים ב-`ToolBubble.svelte`. בתחילה תוכננה שרשרת A→B→C כדי להימנע מ-merge
conflicts בין branches — אבל ב-worktree יחיד אין conflicts כלל, כך שהנימוק לפיצול ביטל את
עצמו. הנושאים קטנים, קוהרנטיים ("שיפורי רינדור"), ועצמאיים-לוגית, אז commit-per-נושא מאפשר
merge חלקי אם אחד מסתבך — בלי overhead של 3 dispatch/אביגיל/כלב/merge.

- **טבלאות MD**: השורש — `markdown.ts` ALLOWED_TAGS חסר תגי טבלה, DOMPurify מוחק את מה
  ש-marked כבר מייצר (`gfm:true`). תיקון: allowlist + `align` (marked מייצר attr, **לא** style)
  + CSS. אומת ש-marked v18 פולט `<th align="left">`.
- **תמונות**: ACP `image` content (`{data:base64, mimeType}`) מופה היום ל-`{type:"other"}`
  ומודפס כ-JSON. הוספת `ToolContentImage` + רינדור `<img>`. גם `resource` blob עם `image/*`
  (אותו רינדור). **SVG מתירני** — `<img>` מנטרל scripting ב-secure-static-mode, עם invariant
  מתועד "רק `<img>`, לעולם לא inline".
- **העדפות-תצוגה**: ברירות-מחדל שומרות התנהגות נוכחית (`collapseThoughts:false`,
  `expandTools:false`); רק ה-default נשמר ב-settings, override ידני per-bubble הוא per-render.

### ממצאי אביגיל
verdict=**READY** (0 חוסמים, 2 findings ירוקים). #1: כפתור reset סלקטיבי ולא גלובלי —
ניסוח "עקביות" תוקן. #2 (משמעותי): `ToolBubble:121` כופה reactivity על `tc.status`; חשש
ל-snap-back שיכפה `open` מחדש ויבטל קיפול ידני באמצע turn. ב-Svelte 5 fine-grained כנראה
לא קורה, אך חוזק ב-§6 כ-risk עם הנחיית בדיקה-בפועל + פתרון נפילה (local `$state` per-bubble).
(הערה: אביגיל לא כתבה קובץ report פיזי — ה-verdict+findings תועדו כאן מהתמצית.)

### שינויי-כיוון
- מ-3 briefs בשרשרת → brief אחד / 3 commits (בקשת המשתמשת; הנימוק לשרשור קרס תחת worktree יחיד).
- `resource_link` (`file://`) **הוצא מ-scope** — דורש BE proxy לקבצים מקומיים (LFI/path-traversal),
  נרשם ב-roadmap כ-slice **local-file-proxy** נפרד (Track C, תלוי ב-slice זה).

### רעיונות שנדחו
- **שמרני ל-SVG** (raster בלבד): נדחה — `<img>` בטוח, ו-SVG נפוץ בפרויקטי קוד.
- **persist של מצב פתוח/סגור per-bubble**: נדחה — רק ה-default נשמר, override ידני per-render.
- **audio / resource-text content**: future (סוגי מדיה אחרים, fallback ל-JSON נשמר).

## 2026-06-22 — slice-wake-lock: מתג "השאר מסך דלוק" + WakeLockEngine

### רציונל

באג שמטריד בעיקר בנייד: המסך נכבה באמצע שהסוכן עובד / בזמן האזנה לתשובה. ה-Web
**Screen Wake Lock API** פותר בדיוק את זה. בקשת המשתמשת: שזו תהיה **הגדרה** שניתן
להדליק/לכבות, לא התנהגות כפויה. הפיצ'ר כבר ברודמ"פ — Track C, "drive-first chrome
(car mode, Media Session, **wake lock**)".

**הכרעת סמנטיקה: נעילה כל-עוד-הטאב-גלוי, לא רק-בזמן-turn-פעיל.** מתג שהמשתמשת מדליקה
במפורש צריך להיות צפוי — מסך שנכבה באמצע קריאת תשובה ארוכה (כי ה-turn הסתיים) הוא
הפתעה גרועה. בהקשר hands-free/נהיגה רוצים את המסך דלוק לאורך כל ה-session כדי להעיף
מבט. הסוללה היא tradeoff שהמשתמשת בוחרת מדעת (opt-in, default `false`). עידון עתידי
"רק בזמן פעילות" (חיסכון סוללה) אפשרי בסלייס שיגדיר "פעילות" (turn/mic/speaker).

**הכרעת ארכיטקטורה: `WakeLockEngine` (engines/) owner של ה-`WakeLockSentinel`, מחווט
דרך `$effect` יחיד ב-`+layout.svelte`** — לא ב-VM. זו סטייה **מודעת** מחוק-הזהב 4 של
ה-FE (`AGENTS.md:70`), שנותן דוגמה "`Mic.state === recording` צריך wake-lock? → ב-Mic"
— כלומר מחברי ה-design דמיינו wake-lock בתוך VM. ההצדקה: כאן הנעילה גלובלית-לאפליקציה
ולא נגזרת מ-state של entity יחיד, אלא ממתג גלובלי (`settings.screenWakeLock`). זה בדיוק
המקרה של ה-`$effect` הקיים של dir/lang sync, שכבר חי ב-`+layout` כי `<html>` הוא
app-global. ה-engine **לא** ב-`context.ts` — אף component/VM לא צורך אותו (רק +layout
מזין), אז context pair היה dead code.

ה-gotcha המרכזי של ה-API מעוגן ב-DoD (#6): הדפדפן משחרר את הנעילה אוטומטית בכל הסתרת
טאב, ולא מחזיר אותה לבד — לכן ה-engine מאזין ל-`visibilitychange` ותופס-מחדש.

### ממצאי אביגיל

r1 = **READY** בסבב ראשון (נדיר — track record היה 100% briefs-with-issues עד כה). 3
findings, כולן 0-min: (#1 🟡) חוק-זהב 1 מונה 'wakelock' מפורשות כ-side-effect אסור
ב-`$effect` — ה-brief מפרש כ-routes-only, עקבי עם precedent של dir/lang (לא חוסם,
ומתועד מראש ב-brief); (#2 🟢) אין precedent ל-`dispose()` ב-engines (cues חושף
`close()`); (#3 🟢) snippet UI בלי wrapper `divide-y`. כל 8 ה-spot-checks אומתו factual
(דפוס muted, `$effect` של dir/lang, חתימת `SettingToggle`, `WakeLockSentinel` ב-DOM lib).

### שינויי-כיוון

קלים בלבד — קיפלתי את שתי ה-🟢 לתוך ה-brief כהבהרות (dispose סינכרוני במכוון ≠ close
אסינכרוני; toggle בודד לא צריך wrapper) כדי לאטום אותו. הסמנטיקה והארכיטקטורה לא השתנו.

### רעיונות שנדחו

- **נעילה רק בזמן turn פעיל** — חיסכון סוללה אבל כיבוי מפתיע באמצע קריאה. נדחה ל-v1,
  אופציה לעידון עתידי.
- **wake-lock בתוך VM (Mic/AgentSession)** — מה שחוק-זהב 4 מרמז עליו. נדחה כי הנעילה
  גלובלית-לאפליקציה, לא נגזרת מ-entity יחיד; +layout הוא ה-owner הנכון (כמו dir/lang).
- **`WakeLockEngine` ב-`context.ts`** — dead code (אין צרכן מלבד +layout).

## 2026-06-21 — slice-session-prefs-per-cwd: שמירת state של סשן פר-פרויקט בצד שרת

### רציונל

המשך-ישיר לאבחון של "הריצה נעצרת": גילינו ש-`bypassPermissions` פותר את התקיעה (האדפטר עושה
short-circuit ולא שולח `request_permission` — אומת חי על agent `920d6c43`), אבל הבחירה במצב
**לא נשמרת** — היא runtime-only (`session/set_config_option`) לאותו סשן. בכל סשן חדש המשתמשת
נאלצת לבחור מחדש.

**ההכרעה: לשמור את ה-state של הסשן (mode/model/agent/config) פר-`(cwd, cliKind)` בצד שרת, לא ב-localStorage.**
הנימוק המכריע — drive-coding הוא **multi-device מעצם הגדרתו** (voice/car/mobile): בוחרים
`bypassPermissions` במחשב בבית, נכנסים לרכב ומתחברים מהטלפון לאותו BE — וצריך שייזכר.
localStorage שובר את זה כי הוא per-device. אחסון ב-BE מסתנכרן בין כל המכשירים המחוברים לאותו
שרת, וה-`cwd` ממילא שייך לוגית ל-BE (זה ה-filesystem שלו). זה גם צעד ראשון עקבי לכיוון
backend-managed (state נודד ל-BE).

**ההחלטה על הנתיב**: כל ה-stores עוברים מ-`<worktree>/data/` (מעורבב בקוד, נפרד בין dev/main)
ל-`~/.drive-coding/` — תיקיית בית יציבה, משותפת בין deployments, עם `DRIVE_CODING_DATA_DIR`
override קריטי כדי שבדיקות/worktrees לא יזהמו data חי. migration של recordings/cache קיימים
= פעולה תפעולית-ידנית (`cp -n`), **לא** קוד-startup, כדי לא לסכן data חי ב-race.

### ממצאי אביגיל

3 סבבים עד READY. r1 = USABLE-AFTER-FIX (6 findings, 2×🔴): (#1) הנחתי מסלול `newSession` יחיד
אך יש **שניים** fresh (`attach()` ו-`newSession()` ציבורי) מול שלושה load/warm — תוקן עם helper
`#captureSessionConfigFresh`; (#2) Commit 3 (voice) הסתמך על `applyRuntimeMuted` שלא קיים — voice
דורש runtime-tier ב-`Settings`. r2 = USABLE-AFTER-FIX (4 findings, 0×🔴): `applyConfigOption` יש
בו **5** success-returns לא 3 (תוקן עם wrapper boolean); `SavedSessionState` חייב לשבת ב-core ולא
ב-backend (אחרת coupling FE→backend שלא קיים היום); `buildAvailableModes` הוא בקוד האדפטר החיצוני
לא ב-drive-coding. r3 = READY (2×🟢 cosmetic). track record נמשך: 100% briefs עם בעיה אמיתית.

### שינויי-כיוון

תוכנן תחילה client-side (localStorage) — המשתמשת עצרה ושאלה "צד שרת או לקוח?", מה שחשף שה-multi-device
שובר את גישת ה-localStorage. שונה ל-BE. בעקבות ממצא אביגיל r1, **voice/muted נדחה ל-slice נפרד**
(`slice-voice-prefs-per-project`) — tier שונה (UI-prefs ב-localStorage מול ACP session-config),
דורש runtime-override layer ב-`Settings`. הסלייס הזה התמקד ב-session-config בלבד.

### רעיונות שנדחו

- ‏**localStorage (per-device)** — נדחה בגלל multi-device (הליבה של drive-coding).
- ‏**migration אוטומטי ב-startup** — נדחה (סיכון race/partial-copy על recordings חיים); ידני במקום.
- ‏**voice override-on-top באותו slice** — נדחה (mechanism `applyRuntimeMuted` לא קיים, tier נפרד) → slice ייעודי.
- ‏**`permissions.defaultMode` ב-claude settings** (חלופה ללא קוד) — נדחה כפתרון ראשי: גלובלי לכל ה-CLIs, לא מבודד ל-drive-coding, ולא נותן את חוויית ה-UI.

## 2026-06-21 — slice-release-cli-hardening: fixtures strip + CLI flags + --help

### רציונל

קידום ה-NPM package `drive-coding` (packages/release/) לקראת publish. שתי מטרות אמיתיות:
(1) הסרת דליפה — `frontend-dist/fixtures/` (~2MB sessions מוקלטים, כולל `salary-*.json`
שנשמעים אישיים) נכנס ל-tarball הציבורי. הם DEV-only (`MOCK_FIXTURES` מאחורי
`import.meta.env.DEV`), לכן מוחרגים מהעותק של ה-release ב-build.mjs בלבד — dev לא נפגע.
(2) בקשת המשתמשת — config דרך flags (לא רק env vars) + `--help`. נוסף `parseArgs`
(`node:util`, בלי dependency), flags `--port/--opencode-bin/--fe-static-dir/--cors-origins`,
`--help`, `--version`, עם קדימות flag > env > default (flag דורס env דרך הצבה לפני ה-`??=`).

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX, **תפסה 🔴 קריטי**: ה-brief המקורי כלל "Commit 0 — תיקון FE path
resolution" בטענה שה-package שבור (404 מהתקנה נקייה). **הטענה הופרכה.** אומת עד הסוף:
`import.meta.dirname` בבאנדל נפתר נכון ל-`dist/`, ו-candidate `../frontend-dist` נבחר.
r2 = READY (1×🟢: `--port` לא-מספרי → NaN → bind שקט; קופל פנימה כולידציה).

### שינויי-כיוון

ה-FE-path "blocker" כולו נמחק מה-brief. ה-package **עובד ומוכן לפרסום כמו שהוא** —
ה-slice הוא שיפורים בלבד, לא תיקון.

### רעיונות שנדחו

- **תיקון FE path resolution (process.argv[1] במקום import.meta.dirname):** נדחה — אין באג.
- **config-file ממשי (JSON/TOML):** נדחה — flags מספיקים; env-vars נשארים מקור-האמת ש-flags דורסים.
- **חשיפת debug envs (LOG_WIRE/WIRE_RECORD) כ-flags:** נדחה — נשארים env-only (לא user-facing).

### לקח מתודולוגי (false-blocker)

ה-404 שהוליד את ה"blocker" המדומה נבע **אך ורק** מכך שה-session של מרדכי מייצא
`FE_STATIC_DIR=.../dev/packages/frontend/build` (מסקריפט הרצת dev) — זה דלף לכל בדיקת
install-נקי, וה-`??=` ב-bin היה no-op. עם `env -u FE_STATIC_DIR` + עץ dev מוסתר → 200
מה-`frontend-dist` הארוז. **כלל חדש שנכנס ל-brief**: כל בדיקת install חייבת `env -u
FE_STATIC_DIR -u CORS_ORIGINS -u OPENCODE_BIN`. ערך אביגיל כאן היה למנוע dispatch של
תיקון מיותר לבאג שלא קיים.

---

## 2026-06-19 — slice-wire-observability-bridge: העברת תצפית ה-wire לשכבת הגשר

### רציונל

המשך-ישיר ל-`slice-ws-error-survival`. אותו slice תיקן שה-child **שורד** ניתוק דפדפן, אבל
דיבוג חי (19/6) חשף שהתסמין האמיתי שונה ממה ש-§11 הניח: ברוב המקרים **התהליך לא מת — אבל
הריצה נעצרת**. כדי לאבחן את זה צריך לראות את זרם ה-wire של ה-agent **גם כשאין דפדפן** — וכאן
התגלה ה-gap: כל ה-wire observability (live log של `LOG_WIRE` ב-ns `backend.ws.wire`, וגם
`WIRE_RECORD`) חי **בתוך `ws-agent.ts`**, ב-`onLine` callback וב-message handler — שניהם
מתבטלים ב-`detach()` (`unsub()` + `rec.close()`). כלומר ברגע הניתוק אנחנו עיוורים בדיוק
כשצריך לראות. זה מה ש-Commit 3 (observability) של ה-slice הקודם לא כיסה — הוא הוסיף לוג ל-error
path, לא לזרם ה-stdout/stdin עצמו.

**ההכרעה: להוריד את נקודת-התצפית מהשכבה שמתנתקת (`ws-agent`) לשכבה שמחזיקה את ה-child ושורדת
(`bridge-manager`).** ה-reader הקבוע `stdoutRl` הוא כבר הבעלים של `child.stdout` ורץ כל חיי
ה-child → שם נכנס תיעוד כיוון ה-"in". כיוון ה-"out" עובר דרך method חדש `bridgeManager.writeStdin()`
(במקום `child.stdin.write` ישיר ב-ws-agent), שמתעד גם הוא. כך התצפית **סימטרית, רציפה דרך
disconnect→reconnect, ובלי פערים עיוורים**. ה-recording session הופך per-child-lifetime (לא
per-WS-connection). ה-ns עובר מ-`backend.ws.wire` ל-`backend.acp.wire` — סמנטי נכון (זה ה-CLI↔BE
wire, לא BE↔FE), וכבר ממופה ל-`LOG_WIRE=acp` ב-`core/log/config.ts`.

> **גבול scope מפורש**: הבריף **נותן את העיניים** לאבחן את "הריצה נעצרת" — הוא לא מתקן את
> התקיעה. ההשערה החזקה (FE הוא ה-ACP client → בקשת-קליינט שלא נענית כשאין דפדפן) תיבדק
> ב-slice נפרד, עם התצפית החדשה ביד.

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX (5 findings). ה-blocker (🔴 #1+#2): פספסתי call-site שלם —
`ws-agent-pipe.test.ts` עם 7 קריאות ל-`createAgentWsHandler` ו-mock `bridgeManager` בלי
`writeStdin`; הסרת `wireRecorder` מה-deps הייתה מפילה typecheck ב-7 מקומות, והמעבר ל-`writeStdin`
היה שובר את הטסט "FE message forwarded to child.stdin" **ב-runtime** (ה-mock לא כותב ל-stdin).
תוקן: §4.ד מפרט הסרת `wireRecorder` + הוספת `writeStdin` ל-mock. עוד: (#3) ה-return type הוא
inline object, אין שינוי ב-`core/ports.ts`; (#4) אין rec-leak ב-spawn-fail path (rec.open אחרי
pid-guard); (#5) `LOG_WIRE=ws` ב-`docs/deploy-local-service.md:99`, לא ב-systemd units. r2 = READY
(2 findings 🟢 קוסמטיים: off-by-one בציטוט שורות, walkthrough היסטורי out-of-scope).

### שינויי-כיוון

ה-blocker של אביגיל חידד שזה refactor שנוגע ב-**3 קבצי טסט** (לא אחד) — מה שהצדיק commit אטומי
אחד (in+out+recorder יחד) במקום פיצול, כדי להימנע מ-double-logging זמני.

### רעיונות שנדחו

- **לתעד `$/ping`/`$/pong` ב-wire** — נדחה: זה transport keepalive (BE↔FE, ענייני NAT), לא עובר
  ל-child ולא חלק מ-ACP wire. יורד מהתיעוד.
- **לפצל ל-2 commits (הוסף ל-bridge → הסר מ-ws-agent)** — נדחה: יוצר double-logging/recording זמני
  כי שתי השכבות היו מתעדות את אותו frame. commit אטומי במקום.
- **להשאיר `backend.ws.wire` כ-alias ל-backward-compat** — נדחה: אין צרכן קוד חי אחרי השינוי
  (אומת ב-grep), `LOG_WIRE=acp` מכסה. פחות בלבול.

## 2026-06-18 — slice-ws-error-survival: ניתוק דפדפן לא יפיל את ה-BE

### רציונל

המשתמשת דיווחה שכשחיבור הדפדפן משתבש/מתנתק, גם ה-CLI agent (claude-code/opencode)
מפסיק לרוץ — התנהגות לא-צפויה, שכן ה-backend הוא בעל התהליך. החקירה גילתה ש-`ws-agent.ts`
דווקא **נכון** בניתוק נקי (`feWs.on("close")` מבצע detach בלי `child.kill`). הבאג הוא
בניתוק **לא-נקי**: ה-socket פולט אירוע `'error'`, אין לו listener בשום מקום → ב-Node זה
throw → `uncaughtException` → ה-handler הגלובלי ב-`server.ts:14-20` עושה `process.exit(1)`
→ כל ה-backend נופל, וה-child (spawn ללא `detached`) מת כ-collateral.

**ההכרעה: שלוש שכבות.** (0) `feWs.on("error")` שמטפל כמו close (detach idempotent,
בלי kill) — חוסם במקור. (1) error listeners על `echoWss`/`agentWss`/ws-echo — סותם
מקורות WS error נוספים. (2) הגנה בעומק — `uncaughtException` מסנן transient socket
errors (`isTransientSocketError` טהור: ECONNRESET/EPIPE/ENOTCONN/ECONNABORTED/ETIMEDOUT)
ולא יוצא עליהם, אבל **שומר** `process.exit` לשגיאות אמיתיות (קו-הגנה אחרון לגיטימי).

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX (2 findings, שניהם בתיאור הטסט/הבהרות — לא בקוד הייצור): (#1)
mock WS כ-EventEmitter לא מספק structurally את חתימת `ws.WebSocket` תחת strict → דרוש
`as unknown as WebSocket` (הבריף השמיט); (#2) `lint:i18n` חוסם רק string literals,
לא הערות — הבריף רמז על כלל מחמיר מדי. תוקנו. r2 = READY (1 finding 🟢 קוסמטי: ציטוט
מספר שורה :9→:6, עלות אפס — תוקן). כל ה-claims העובדתיים (שורות, symbols, paths)
אומתו 1:1, כולל אישור ש-ה-child לא detached ולכן מת עם ה-backend.

### שינויי-כיוון

- **שני באגים נפרדים זוהו, slice אחד מתקן רק את הקריסה.** ה-thrashing של אותו session
  בשני טאבים (MED-8 livelock) הופרד ל-slice עתידי (תועד ב-`roadmap.md` Track F) — בעיה
  של connection-arbitration, לא error-handling. לא מערבבים scope/verification.

### רעיונות שנדחו

- **ריכוך uncaughtException בלבד (בלי שכבה 0):** היה מסתיר את הבאג במקום לתקנו, ומסכן
  בליעת שגיאות אמיתיות. נדחה — שכבה 0 (טיפול במקור) היא התיקון הנכון; שכבה 2 רק
  belt-and-suspenders, מוגבלת לרשימת codes סגורה.
- **Backend-managed session ownership (HTTP/SSE transport):** פתרון-שורש לכל משפחת
  בעיות ה-WS, אבל refactor ארכיטקטוני גדול. נשאר ב-Future (roadmap) — לא נדרש כדי
  לעצור את הקריסה.

## 2026-06-16 — slice-npm-publish: אריזה ל-npm כ-tarball self-contained

### רציונל

המשך ישיר ל-slice-bunx-single-command (depends_on). המטרה: `bunx drive-coding`
מ-npm. הבדיקה הראתה ששני deps לא יושבים ב-registry — `@drive-coding/core` (workspace,
private, exports ל-`src/*.ts`) ו-`provider-contract` (git dep, 404 ב-npm, אבל בנוי עם
`dist/`). ההכרעה: **`bundledDependencies`** לשניהם — נארזים פנימה ל-tarball, בלי לפרסם
אותם בנפרד ובלי לדרוש git מהמשתמש הקצה.

ה-package המתפרסם = `packages/backend` ששמו משתנה ל-`drive-coding` (כבר מחזיק את ה-bin
ואת כל ה-runtime deps; אביגיל אימתה שאף אחד לא תלוי ב-`@drive-coding/backend` כ-import).
ה-FE build מועתק לתוך החבילה ב-`prepack` (`frontend-dist/`), וה-bin בוחר בין dev-path
ל-packaged-path לפי קיום הקובץ.

**Scope עד tarball שמתקין ורץ מקומית** — `npm publish` ל-registry הוא הצעד האנושי האחרון
(credentials + שם + אישור), מחוץ ל-slice.

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX (5 findings, 2 🔴). הקריטי (#1): `bundledDependencies` אורז את
**קבצי** core אבל לא את עץ ה-deps שלו — core מייבא `pino`/`pino-pretty`/`marked` שלא
מוצהרים ב-backend → התקנה נקייה קורסת ב-boot עם `Cannot find module 'pino'`, וזה נראה
מטעה כמו בעיית symlink. #2: ה-base branch (התלות) עדיין לא קיים. #4: `npm pack` מסרב
לארוז `private` bundledDependency. r2 = READY (נותר רק ה-gate התזמוני המתועד).

### שינויי-כיוון

- **הכרזת transitive deps על פני bundling רקורסיבי:** `pino`/`pino-pretty`/`marked`
  הוכרזו כ-`dependencies` של ה-package (מותקנים מ-registry), במקום לנסות לבנדל את כל
  עץ ה-deps של core. פשוט יותר ועמיד.
- **core הופך packable** (הסרת `private`, version 0.1.0) — בלי לפרסמו בנפרד.
- **gate תזמוני מפורש** ב-§0: ה-slice לא מתחיל לפני שה-branch של התלות קיים או נמרג ל-dev.

### רעיונות שנדחו

- **פרסום `@drive-coding/core` ו-`provider-contract` כ-packages נפרדים ל-npm:** "נכון"
  ל-monorepo אבל דורש תיאום-גרסאות ופרסום של 3 packages. נדחה לטובת bundledDependencies
  (חבילה אחת self-contained).
- **`npm publish` בתוך ה-slice:** נדחה — צעד אנושי אחרון אחרי merge.

## 2026-06-16 — slice-bunx-single-command: הרצה בפקודה אחת דרך bunx

> **2026-06-17 — מוזג ל-dev** (merge commit `ea7726f`, `--no-ff`). כלב: GO (light, 0 findings).
> מרדכי אימת runtime נוסף מעבר ל-DoD: `bun link` חשף את ה-`bin` כ-`drive-coding` גלובלי,
> הרצה מ-`/tmp` כפקודה עירומה → HTTP 200 + FE + API. אומת גם ש-`FE_STATIC_DIR ??=`
> מכבד env מפורש על פני ה-default (env precedence) כפי שתוכנן. אישור מיזוג מפורש מהמשתמשת.

### רציונל

המשתמש ביקש להריץ את הפרויקט "מ-npx בפקודה אחת". הפרויקט הוא monorepo (pnpm) עם
backend (Hono), frontend (SvelteKit/adapter-static), ו-core. הבדיקה הראתה ש**הבעיה
אינה ה-runtime** אלא אריזה: ה-backend כבר משתמש ב-`@hono/node-server` (אין `Bun.serve`
בקוד — ה-comment בטסט התיישן) ויודע להגיש את ה-FE הבנוי דרך `FE_STATIC_DIR` (single-origin).
מה שחסר: `bin` entry שמחבר את שני אלה בפקודה אחת.

**ההכרעה: `bunx` — לא Node, לא bundling.** שלוש עובדות הכריעו:
1. `tsconfig.base.json` עם `moduleResolution: "Bundler"` — הקוד מתוכנן ל-Bun/bundler,
   לא ל-`tsc → node`.
2. ה-plugin `packages/backend/plugins/prompt-injector.ts` **חייב להישאר .ts נגיש
   ב-runtime** — OpenCode טוען אותו דרך `file://` באמצעות Bun. bundling היה שובר אותו.
3. production (Dockerfile, systemd) כבר רץ עם Bun.

bunx מריץ את ה-TS ישירות כמו production — אפס מרחק בין dev ל-prod, ואפס עבודת bundling.

**Scope מצומצם בכוונה (JIT):** ה-slice הזה הוא ה-**mechanism** המקומי בלבד —
`bin/drive-coding.ts` שמגדיר `FE_STATIC_DIR`+`PORT` ומייבא את server.ts, launcher
שבונה FE אם חסר, ו-preflight. **פרסום ל-npm בפועל** (הסרת `private`, פתרון
`@drive-coding/core` workspace + `provider-contract` git dependency, `prepublishOnly`)
נדחה ל-slice המשך נפרד (`slice-npm-publish`), כדי ללמוד מה-mechanism לפני ה-publish.

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX (4 findings). כל ההנחות הארכיטקטוניות הקריטיות אומתו — במיוחד
ש-`server.ts` הוא **self-starting on-import** (אין `startServer()`; `serve()` ב-top-level),
שעליה נשען כל ה-API skeleton. שני פערי-אימות אמיתיים: (1) `bin/` מחוץ ל-`src/` היה גורם
ל-`pnpm typecheck` לדלג עליו בשקט (false-positive ל-DoD); (3) פקודות האימות היו bash-only
בעוד סביבת ה-dev היא Windows/PowerShell. r2 = READY, 0 findings.

### שינויי-כיוון

לפי ממצא #1 — ה-bin הועבר מ-`packages/backend/bin/` אל **`packages/backend/src/bin/`**,
כך שהוא נכלל אוטומטית ב-`include: ["src/**/*"]` ו-typecheck מכסה גם אותו וגם את ה-`import`,
**בלי לגעת ב-`rootDir`/`outDir`**. זה עדיף על הרחבת ה-tsconfig (שהיתה משנה מבנה output).
כל פקודות האימות הומרו ל-PowerShell.

### רעיונות שנדחו

- **bundling ל-JS יחיד (node-compatible):** היה מאפשר `npx` על Node טהור ומעלים את ה-git/
  workspace deps — אבל שובר את טעינת ה-plugin דרך `file://` ומנוגד ל-`moduleResolution: Bundler`
  ולכל ה-production stack שרץ Bun. נדחה לטובת bunx.
- **פרסום ל-npm בתוך ה-slice הזה:** נדחה ל-slice נפרד (JIT — לא לבנות publish לפני
  שה-mechanism עובד ונבדק).

## 2026-06-18 — slice-release-package: package נפרד מבונדל ל-bunx (החליף את slice-npm-publish)

### רציונל

המטרה: `bunx drive-coding` עובד מהתקנה נקייה מ-npm. הדרך לשם התבררה רק אחרי
שלוש גישות שנפלו אחת-אחת באימות אמפירי (spikes):

1. **`bundledDependencies` (slice-npm-publish, נזרק):** ארז את core+provider-contract
   כקבצים בתוך ה-tarball. **עובד עם npm, נשבר עם bun** — `bun add`/`bunx` מתעלמים משדה
   `bundledDependencies` ומנסים לפתור מחדש את ה-specs המקוריים: `@drive-coding/core@workspace:*`
   (לא קיים מחוץ ל-monorepo) ו-`provider-contract@git+...` (repo **פרטי** → 404 ל-bun הלא-מאומת).
   מאחר שה-headline הוא `bunx`, זו חסימה.
2. **devDependencies:** הרעיון — להוציא את core/provider-contract מ-`dependencies` כדי ש-bun
   לא ינסה לפתור. אבל `bundledDependencies` **חייב להיות תת-קבוצה של `dependencies`** — npm
   הפסיק לארוז אותם (457→89 קבצים), וה-runtime קרס `Cannot find module @drive-coding/core`.
3. **git URL ציבורי / auth:** bun **יודע** git+https; ה-404 הוא כי ה-repo פרטי. אבל חבילה
   ציבורית לא יכולה לתלות ב-repo פרטי, ו-`workspace:*` של core אין לו git URL בכלל.

**ההכרעה: package נפרד `packages/release/` שמבונדל בזמן build.** `bun build` של ה-bin
מטמיע (inline) את core+provider-contract לתוך JS אחד → הם **נעלמים מגרף התלויות** → אין
מה לפתור, לא משנה איזה installer. external רק ל-`pino`/`pino-pretty` (worker-thread, לא
ניתנים ל-bundling — נשארים deps ציבוריים ש-bun פותר). ה-packages הקיימים
(backend/core/provider-contract) **לא נגעו** — נשארים workspace/git/private (זמני, יהפכו
ל-public בעתיד). זה היפוך מודע של ההחלטה של slice-bunx ("no bundling") — שתי הסיבות שלה
פגו: (א) אומת שה-plugin (`file://` ע"י תהליך opencode נפרד) **לא** מבונדל ולכן לא נשבר;
(ב) `bundledDependencies` ⊥ bun הוכח אמפירית. בחירת המשתמשת: package נפרד על-פני עריכת
ה-monorepo "הזמני".

### ממצאי אביגיל

r1 = USABLE-AFTER-FIX (4 findings). שני 🔴 חשובים: (#1) ה-brief תיאר את ה-bin של
slice-npm-publish (dual-layout) במקום את ה-bin האמיתי של dev (single-line) — ה-spike
רץ על הבסיס הלא-נכון; (#2) ה-script `build` היה נתפס ע"י `pnpm -r run build` ומפעיל
build כבד לא-מכוון. תוקנו: ה-script שונה ל-`bundle`, וה-Commit עודכן ל-bin האמיתי
(single-line + הוספת `existsSync`). r2 = READY, 0 findings.

### שינויי-כיוון

- **הנגיעה היחידה ב-backend**: ה-FE cascade ב-`src/bin/drive-coding.ts` שונה ל-2-candidate
  (`../frontend-dist` ל-bundle, `../../../frontend/build` ל-dev) — שיפור path-resolution
  כללי, לא מחיקת תלויות. אומת לשני ה-layouts.
- **guard ל--sourcemap**: התגלה באג ב-bun 1.3.14 — `bun build --sourcemap --outfile` מתעלם
  מ-`--outfile` ופולט לתיקיית ה-entry. נוגע רק ל-build של release (לא ל-dev, ששם אין
  bundling). הוגן guard דו-שכבתי: `files` מצומצם ל-`dist/drive-coding.js` בלבד + assertion
  ב-build.mjs שמפיל את ה-build אם `.map` מופיע או אם הבאנדל חסר. מאומת ששתי השכבות תופסות.

### רעיונות שנדחו

- **`bundledDependencies` (slice-npm-publish):** נזרק — ⊥ bun (ראה רציונל). ה-worktree
  וה-branch נמחקו (לא merged).
- **bundling בתוך backend (טיוטת slice-bundle-single-artifact):** היה דורש מחיקת deps
  ושכתוב prepack של backend. נדחה לטובת package נפרד — additive, הפיך, בלי לגעת ב-monorepo
  "הזמני" (בקשת המשתמשת).
- **release-own bin shim (אפס נגיעה ב-backend):** היה מונע את הנגיעה ב-bin, אבל משכפל את
  לוגיקת ה-preflight/URL. נדחה — ה-cascade הוא שיפור כללי ובטוח ממילא.
