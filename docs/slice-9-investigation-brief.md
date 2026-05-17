# Slice 9 — Investigation brief (חקירה לפני תיקונים)

> **מטרה:** חקירה יסודית של ה-frontend החי אחרי Slice 9 כדי לאפיין את כל
> ה-bugs, להשוות למה שאמור להיות (mockup + brief), ולמצוא bugs נוספים שלא
> תועדו. **אפס שינוי קוד** — רק חקירה ודיווח.
>
> **תפקיד:** קורא וחוקר. אסור לערוך קוד או commit. רק יוצר דוח חדש +
> screenshots + logs.
> **Sub-agent:** **Opus 4.7** — דורש הקשר רחב ודיוק עמוק (הרבה קבצים, השוואה
> חזותית עם mockup, חיבור בין תופעות).
> **זמן הערכה:** 1-2 שעות.
>
> **תוצר:** `docs/slice-9-bugs-investigation.md` (חדש, ‏~500-1000 שורות).
> אחרי החקירה — סוכן Sonnet יקבל את הדוח ויתקן.

---

## 1. מה לחקור

### 1.1 — אימות ה-bugs המתועדים (16 bugs)

‏קרא `docs/slice-9-followup-fixes.md` קצה-לקצה. עבור על כל B1-B16 ו-Q2-Q8:

- ‏לכל bug — **אמת או הפרך**: האם הוא קיים בפועל?
- ‏אם קיים — תעד **reproduction steps** מדויקים (איך לשחזר)
- ‏אם קיים — תעד **את הroot cause** עד כמה שאפשר (file:line, function name, exact behavior)
- ‏אם לא קיים — תעד שהבדיקה עברה + איך בדקת

‏זו לא רשימה ל-checkbox. כל bug דורש חקירה אמיתית — לא רק "כן/לא".

### 1.2 — השוואה ל-mockup (final.html)

‏פתח את שני המקורות במקביל:
- ‏**Mockup** (האמת): `/tmp/drive-coding-mockups/final.html` + `shared.css`
  (זמין גם דרך `https://your-app-mockups.nue.tuns.sh/final.html`)
- ‏**Frontend חי**: `https://your-app.nue.tuns.sh`
  (גם דרך linux-gui browser)

‏עבור על כל view ב-mockup (5 views של mobile + desktop) והשווה לחי:

| View ב-mockup | מה לבדוק ב-frontend |
|----------------|---------------------|
| Mobile idle | header צף, bubbles בכרונולוגיה, mic 110px במרכז, sheet handle |
| Mobile recording | mic אדום + pulse |
| Mobile speaking | cluster 3 כפתורים (prev/main/next), bubble currently-playing מודגש |
| Mobile after TTS | ⟲ replay button מופיע ליד mic |
| Mobile sheet open | רשימת agents + ניווט + ⚙ + 📚 + 🚗 toggle |
| Desktop | sidebar + chat + cluster מורחב (⟲ + ⏮ + main + ⏭) |

‏לכל הבדל — תעד:
- ‏מה צפוי (לפי mockup)
- ‏מה בפועל
- ‏screenshot של הbug

### 1.3 — חיפוש bugs נוספים שלא תועדו

‏צריך למצוא דברים שאני לא ראיתי. הצעות לחקירה:

#### א. ‏TTS audio behavior

‏הקלט (העלה test-voice.mp3) **3-5 פעמים שונות** עם prompts מגוונים:
- ‏prompt קצר (משפט אחד)
- ‏prompt בינוני (3 משפטים)
- ‏prompt עם code (תשובה עם backticks)
- ‏prompt שגורם ל-thoughts ארוכים

‏לכל אחד — תעד:
- ‏כמה bubbles נוצרו
- ‏כמה audio_chunks הגיעו (מהlogs של backend)
- ‏מה נוגן בפועל (האם 2 מילים? duplication? כל הaudio?)
- ‏timing — לאחר כמה זמן ה-audio התחיל

#### ב. ‏סדר ה-bubbles

‏האם bubbles מופיעות בסדר נכון? (user → thought → tool → message)
האם message חדש מצטרף ל-bubble קיימת או יוצר חדשה?

#### ג. ‏State machine של ה-mic

‏תעד את כל המעברים:
- ‏idle → recording (tap mic)
- ‏recording → processing (tap mic שוב, או upload)
- ‏processing → speaking (audio_chunk ראשון מגיע)
- ‏speaking → idle (done)
- ‏speaking → cancelling → idle (tap mic ב-speaking)

‏לכל מעבר — האם הויזואל משתנה? mic color? animation? status text?

#### ד. ‏WS connection

‏האם WS מתחבר מיד? יציב? מתנתק לפעמים?
‏בדוק עם DevTools או עם `playwright-cli console`.

#### ה. ‏Sessions flow

‏צור 2 agents עם cwds שונים. שלח prompt לכל אחד.
‏לך ל-`/sessions`. האם הproject רואה את שניהם?
‏Click על session → האם נטענת history (cold bubbles)?
‏האם dedup עובד אם click שוב על אותו session?

#### ו. ‏Recording playback

‏הקלט. אחרי שmodel ענה, click על ה-user bubble. האם משמיע את ההקלטה?

#### ז. ‏File picker

‏מ-dashboard click "+ סוכן חדש". האם modal פותח? האם רואה תיקיות?
‏Navigate לתת-תיקייה. ‏Click "בחר". האם agent נוצר עם ה-cwd?

#### ח. ‏Settings

‏לך ל-`/settings`. האם voice picker עובד? options מוצגים?
‏Audio cues toggle עובד? נשמר ב-localStorage?

#### ט. ‏Mobile responsive

‏שנה viewport ל-mobile (390×780) דרך devtools או pw-clean.sh.
‏האם sidebar הופך ל-bottom sheet?
‏האם header floats?
‏האם ה-layout מתאים?

#### י. ‏Console errors + warnings

‏ב-`playwright-cli console` — תעד **כל** error או warning, גם אם נראים תמימים.

---

## 2. דרך עבודה

### 2.1 — Environment setup

```bash
# Backend (אם לא חי):
ssh להריצ tmux חדש או — לבדוק עם curl localhost:4000/api/agents

# Frontend:
https://your-app.nue.tuns.sh
או דרך linux-gui:
ssh linux-gui "DISPLAY=:10 /home/test/Documents/scripts/pw-clean.sh \
  https://your-app.nue.tuns.sh \
  --port=9333 --user-data-dir=/dev/shm/pw-investigation"

# Test audio:
/tmp/test-voice.mp3 (קיים אצל אבי)
ssh linux-gui ls /tmp/test-voice.mp3 (קיים גם שם)
```

### 2.2 — Tools זמינים

- ‏`playwright-cli` ב-linux-gui — snapshot, click, eval, console, screenshot
- ‏`scp linux-gui:/path /tmp/` — להעביר screenshots ל-local כדי לראות
- ‏`curl` ל-`localhost:4000/api/*` — לבדוק endpoints
- ‏`tail -f /tmp/be.log` — לראות backend log חי
- ‏`tail -f /tmp/fe.log` — frontend Vite log

### 2.3 — Upload audio דרך linux-gui

```bash
# הפוך input נסתר ל-visible:
ssh linux-gui 'playwright-cli eval "(() => { const i = document.querySelector(\"#audio-file-input\"); i.style.cssText = \"position:fixed;top:10px;left:10px;z-index:9999;display:block\"; return \"ok\"; })()"'

# Click + upload:
ssh linux-gui "playwright-cli click '[id=audio-file-input]'"
sleep 1
ssh linux-gui "playwright-cli upload /tmp/test-voice.mp3"

# המתן 5-10 שניות לתשובה
sleep 10

# Snapshot:
ssh linux-gui "playwright-cli snapshot"
```

### 2.4 — צור agents חדשים לטסט

```bash
curl -s -X POST http://localhost:4000/api/agents \
  -H "Content-Type: application/json" \
  -d '{"cwd":"/home/user/projects/voice-acp-v2","cliKind":"opencode"}' | jq

# נווט אליו:
ssh linux-gui "playwright-cli goto https://your-app.nue.tuns.sh/agent/<id>"
```

---

## 3. מבנה הדוח (`docs/slice-9-bugs-investigation.md`)

```markdown
# Slice 9 — Bugs Investigation Report

> תאריך: <date>
> חקר: Opus 4.7 sub-agent
> Frontend version: commit <sha>

## TL;DR
- ‏סה"כ bugs שנמצאו: N (M critical, K medium, L minor)
- ‏מתוכם: X חדשים שלא היו ב-followup-fixes.md
- ‏הכי דחוף: <list>
- ‏ה-pipeline בכלל עובד? <yes/no/partial>

## 1. אימות ה-bugs המתועדים

### B1 — Bubble grouping שבור
- ‏סטטוס: ✅ אומת / ❌ לא קיים / ⚠️ קיים אבל אחרת
- ‏Reproduction steps:
  1. ...
  2. ...
- ‏Root cause (אם נמצא): packages/.../agent-session.svelte.ts:123, function `handleTextChunk`
- ‏Evidence: screenshot1.png, log snippet
- ‏Severity: 🔴 critical

### B2 — שני אייקוני mic
...

## 2. Bugs חדשים שמצאתי

### N1 — <שם>
- ‏Description
- ‏Reproduction
- ‏Root cause
- ‏Severity

### N2 — ...

## 3. השוואת חזותית ל-mockup

| Element | Mockup | בפועל | מתאים? |
|---------|--------|--------|---------|
| Mobile header | center, floating | ... | ❌ |
| Bubble avatar | bottom-left, popping out | ... | ✅/❌ |
| ...

## 4. Flows שעובדים מקצה-לקצה (אישור)
- ‏✅ STT pipeline (Gemini transcript נכון)
- ‏✅ Recording save (data/recordings/)
- ‏... (לכל flow — ✅ עם evidence או ❌ עם bug)

## 5. Recommendations

### עדיפויות לתיקון (מומלץ לסוכן Sonnet הבא)
1. <bug X> — root cause ברור, ROI גבוה
2. ...

### לא לתקן עכשיו (פוטנציאל)
- <minor bug Y> — קוסמטי, לא דחוף

## 6. Appendix
- ‏A. Screenshots index
- ‏B. Logs snippets
- ‏C. WS protocol messages observed
```

---

## 4. אסור / מותר

**מותר:**
- ‏קריאת כל קובץ ב-repo
- ‏יצירת `docs/slice-9-bugs-investigation.md` (חדש)
- ‏יצירת screenshots ב-`/tmp/investigation/`
- ‏הפעלת curl, playwright-cli, ssh linux-gui
- ‏יצירת agents חדשים דרך API (לא ידחו את הסביבה)
- ‏שינוי visibility של file input ב-frontend ב-eval (זמני, לא commit)

**אסור:**
- ‏עריכת **כל קוד** ב-packages/* (frontend, backend, core)
- ‏commits של קוד
- ‏עדכון docs קיימים (חוץ מעדכון אחד אם רלוונטי — שאל קודם)
- ‏מחיקת agents/recordings/sessions קיימים
- ‏restart backend (אם חי — להשאיר)

‏אם נראה שצריך לעשות commit (לדוגמה — אתה שיניתי visibility של file input) — תעד את השינוי ועשה revert אחרי החקירה.

---

## 5. סקילים חובה

- ‏`dev-conventions` — כדי להבין את הסטנדרטים של הפרויקט (Svelte 5 runes, ESM, etc.)
- ‏`Svelte-MCP` — לחיפוש docs של Svelte 5 בעת ניתוח bugs ($state, $derived, $effect)
- ‏`rtl-adaptation` — להבין את ההנחות של RTL ב-frontend
- ‏`playwright-cli` — לתקשורת עם browser
- ‏`linux-gui-browser` — wrapper לlinux-gui

**אוטונומיה:** אל תבקש רשות. תחקור, תתעד, תיצור את הדוח. רק אם נתקלת
במצב מסוכן (לדוגמה — מערכת חיה שעלולה להישבר) — עצור ושאל.

---

## 6. Prompt לסוכן

**חובה Opus 4.7** — חקירה דורשת הקשר רחב, השוואה ויזואלית, וחיבור בין
תופעות. Sonnet יחמיץ דקויות. עלות Opus מוצדקת כאן.

```
אתה סוכן חקירה (בלבד — אסור לערוך קוד) של ה-frontend של drive-coding.

נתיבים:
- worktree (CWD): /home/user/projects/voice-acp-v2
- frontend חי: https://your-app.nue.tuns.sh
- mockup: https://your-app-mockups.nue.tuns.sh/final.html
  + קבצים: /tmp/drive-coding-mockups/final.html + shared.css
- v1 reference (אם רוצה השוואה): /home/user/projects/voice-acp/frontend/index.html

מקור אמת: docs/slice-9-investigation-brief.md (קרא קצה-לקצה לפני שמתחילים).
מסמכים נלווים שצריך לקרוא:
- docs/slice-9-followup-fixes.md (16 bugs מתועדים)
- docs/slice-9-frontend-refactor-brief.md (ה-brief המקורי)
- docs/tier-1-voice-pipeline-brief.md (WS protocol של Tier 1)
- docs/slice-8a-session-history-brief.md (sessions UI)

עבודה:
1. טען סקילים: dev-conventions, Svelte-MCP, rtl-adaptation, playwright-cli,
   linux-gui-browser.
2. קרא את ה-brief קצה-לקצה.
3. קרא mockup files (final.html + shared.css) כדי להפנים את האמת.
4. קרא את frontend הקיים — כל הקבצים ב-packages/frontend/src/.
5. בצע חקירה לפי 3 חלקי ה-brief:
   א. אימות 16 ה-bugs המתועדים (B1-B16, Q2-Q8)
   ב. השוואה ל-mockup (5 views של mobile + desktop)
   ג. חיפוש bugs נוספים שלא תועדו (9 אזורי חקירה)
6. תיצור דוח: docs/slice-9-bugs-investigation.md לפי המבנה ב-Section 3
   של ה-brief.
7. כל bug עם reproduction steps + root cause + evidence (screenshot/log).
8. בסוף — אם זוהו bugs חדשים, עדכן את docs/slice-9-followup-fixes.md
   להוסיף אותם (זה השינוי docs היחיד שמותר).

ה-backend רץ ב-tmux be על port 4000. ה-frontend ב-tmux fe על port 5173.
linux-gui browser כבר פתוח על port 9333. test-voice.mp3 ב-/tmp/.

אסור לערוך **כל קוד**. רק docs.
אסור commit של קוד.

אוטונומיה גורפת — אל תבקש רשות, תחקור ותדווח.
```

---

## 7. אחרי החקירה

‏הסוכן ימסור דוח מפורט. אבי יסקור. אז:

1. ‏אבי יחליט אילו bugs להעדיף לתיקון
2. ‏נעדכן את `docs/slice-9-followup-fixes.md` עם findings
3. ‏נשלח **סוכן Sonnet 4.6** עם דוח-החקירה כקלט לתיקון

‏ההפרדה חשובה: Opus חוקר (הקשר רחב, דיוק), Sonnet מתקן (implementation לפי spec ברור).
