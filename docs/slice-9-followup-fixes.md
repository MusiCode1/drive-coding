# Slice 9 — Follow-up Fixes brief

> **מטרה:** תיקון הbugs שזוהו אחרי שSlice 9 (Frontend Refactor) הושלם.
> ה-pipeline מ-end-to-end עובד (STT → ACP → TTS → recording save), אבל יש
> bugs ויזואליים חמורים שמונעים שימוש בפועל.
>
> **סוג:** Frontend בעיקר. כלולים גם 2-3 backend fixes.
> **TDD:** חובה ל-logic. CSS pure ויזואלי.
> **Sub-agent:** Sonnet 4.6 **חובה** — לא Opus.
> **זמן הערכה:** 3-5 שעות עבודה.
>
> **בסיס המוצא:**
> - commit `409d86b` (סיום Slice 9 — עם 9 TS errors שתיקנתי ב-commits 7e8a9a... fcc9... שעוד יתווספו)
> - frontend חי על `https://your-app.nue.tuns.sh`
> - backend חי על port 4000

---

## 1. Bugs שכבר תוקנו (commits ידניים, לא צריך לחזור)

| # | קובץ | תיקון |
|---|------|--------|
| F1 | `MicCluster.svelte` | `$derived(fn)` → `$derived.by(() => ...)` + טקסט במקום `()` |
| F2 | `+page.svelte` (dashboard) | `kind` → `cliKind` |
| F3 | `session/[cwdHash]/[id]/+page.svelte` | `kind` → `cliKind` |
| F4 | `voice-session.test.ts` | mock helper — הוספת `bubbles`, `isLoadingHistory`, `clearBubbles`, `getRecordingId` |
| F5 | `core/schemas/agent.ts` | `CreateAgentInput` — הוספת `existingSessionId?` |
| F6 | `agent-orchestrator.ts` + `server.ts` | wiring של `recordingsStore` ל-`createAgentSession` |

‏**סטטוס:** 0 TS errors. 454 backend + 114 frontend tests עוברים. עדיין לא commit-ed לbranch — אצטרך commit לפני שתסוכן יתחיל.

---

## 2. Bugs קריטיים שצריך לתקן (חזותיים — מונעים שימוש)

### 🔴 B1 — Bubble grouping שבור: כל chunk = bubble נפרדת

‏**מה רואים:** כל מילה במשפט של ה-assistant הופכת ל-bubble נפרדת אנכית. במקום bubble אחת עם "שלום, אני שומע אותך. המערכת עובדת תקין", רואים עמודה אנכית של "ש" / "ל" / "ום" / "," / "אני" / "ש" / "ומע" / "אות" / "ך" / "."

‏**צפוי:** כל סגמנט של אותה הודעה (per messageId) ב-bubble אחת. רצף text_chunks אמור להצטרף ל-string רציף בתוך אותה sub-segment.

‏**איפה לחפש:** `packages/frontend/src/lib/stores/agent-session.svelte.ts` — bubble grouping logic. כשמגיע text_chunk חדש:
- ‏אם same kind && same messageId → append to **last segment** of existing bubble
- ‏אם same kind && different messageId → new bubble
- ‏אם different kind → new bubble

‏**הbug הנראה:** כל text_chunk יוצר sub-segment חדש במקום append. או — bubble חדש שלם.

‏**Reference:** mockup `final.html` — bubble.message-group עם sub-segments per sentence (לא per word/chunk).

‏**TDD test:**
```typescript
// 3 chunks ל-message יחיד (same messageId, kind=message):
// "שלום, " → "אני שומע " → "אותך."
// expected: 1 bubble, 1 sub-segment עם הטקסט המלא "שלום, אני שומע אותך."
```

### 🔴 B2 — שני אייקוני mic על הכפתור הראשי

‏**מה רואים:** הכפתור הראשי במצב idle מציג 2 אייקוני mic זה ליד זה. אמור להיות 1.

‏**איפה:** `packages/frontend/src/lib/components/MicCluster.svelte` שורות ~112-120. ייתכן ש-`Icon` רנדר את ה-Lucide פעמיים, או שיש כפילות ב-template.

‏**Reference:** `final.html` — `<i data-lucide="mic"></i>` יחיד.

‏**Fix:** קרא את MicCluster.svelte, וודא ש-`{#if micState === "idle"}` מרנדר אייקון אחד בלבד.

### 🔴 B3 — אין avatars בbubbles

‏**מה רואים:** ה-bubbles נטולי avatar. רק טקסט.

‏**צפוי לפי mockup:**
- ‏User bubble → avatar בצד ימין-תחתון עם `user-round` icon
- ‏Thought bubble → avatar בצד שמאל-תחתון עם `brain` icon
- ‏Tool bubble → avatar בצד שמאל-תחתון עם `wrench` icon
- ‏Message bubble → avatar בצד שמאל-תחתון עם `sparkles` icon
- ‏מיקום: `bottom: -19px`, גודל 28px, ללא חפיפה עם ה-bubble (כמו speech tail בקומיקס)

‏**איפה:**
- ‏`packages/frontend/src/lib/components/BubbleAvatar.svelte` — בדוק שקיים ושמרונדר icon
- ‏`packages/frontend/src/lib/components/BubbleKind.svelte` — בדוק שהוא משלב BubbleAvatar
- ‏ב-template של `agent/[id]/+page.svelte` — בדוק שהuser bubbles מקבלים avatar (לא רק assistant)

‏**Reference CSS:** `/tmp/drive-coding-mockups/final.html` בלוקי `.bubble-kind-avatar` ו-`.bubble-user-avatar`. גם `shared.css` ב-`/tmp/drive-coding-mockups/`.

### 🔴 B4 — textbox + שלח כפתור עדיין שם

‏**מה רואים:** למטה ב-page יש input "הקלד הודעה..." + כפתור "שלח".

‏**אבי אמר במפורש:** "אני בכלל לא רוצה מקלדת ותיבת טקסט בממשק." (משימה ב-Slice 9 §1, נקבע כ-out-of-scope).

‏**איפה:** `packages/frontend/src/routes/agent/[id]/+page.svelte` — חפש `<textarea>` או `<input type="text">` עם placeholder "הקלד הודעה" + button "שלח". הסר את ה-block המלא.

### 🔴 B5 — Header layout לא לפי mockup

‏**מה רואים:**
- ‏Header עליון: ימין `📚` (היסטוריה), שמאל `⚙` (הגדרות), במרכז "opencode" + "voice-acp-v2"
- ‏אבל הסדר נראה הפוך — `📚` בצד שמאל פיזי, `⚙` בצד ימני פיזי. ב-RTL זה אומר ש-📚 אמור להיות "start" (ימין) ו-⚙ "end" (שמאל).

‏**Reference mockup:**
- ‏⚙ בצד ימין (התחלה ב-RTL)
- ‏📚 בצד שמאל (סוף ב-RTL)
- ‏במרכז: agent name (גדול) + session title (קטן)

‏**Fix:** ב-`FloatingHeader.svelte` — וודא flex order נכון. השתמש ב-`justify-content: space-between` + absolute positioning ל-titles באמצע (לפי הmockup הסופי שלי).

### 🟡 B6 — Bottom sheet handle מציץ אבל מעט מדי

‏**מה רואים:** רואים פס גריי קטן בתחתית, אבל לא ברור שאפשר לדחוף אותו למעלה.

‏**Fix:** וודא ש-BottomSheet.svelte:
- ‏מציג grip (40×4 px) ב-center של ה-handle
- ‏יש hover state (`background` משתנה ב-hover)
- ‏tap על ה-grip פותח את ה-sheet

### 🟡 B7 — Sparkles avatar בפינה צד שמאל-תחתון של הdashboard

‏**מה רואים:** איקון sparkles קטן בפינה השמאלית-תחתונה של ה-dashboard view. לא במקום.

‏**איפה:** ‏ככל הנראה ב-`+page.svelte` (dashboard) או ב-`+layout.svelte`. אולי הסוכן הכניס avatar שגוי.

‏**Fix:** מצא ומחק. dashboard אמור להיות clean — רק cards של agents.

---

## 3. Bugs פחות קריטיים

### 🟡 B8 — Choose File button visible (DEV-only — ‏אני חשפתי בטסט)

‏**מה רואים:** כפתור "Choose File" + "No file chosen" מופיע ליד ה-bubbles.

‏**הסבר:** ב-test שלי הפכתי את ה-`#audio-file-input` ל-visible (display:block). ב-prod זה display:none.

‏**Fix:** אם זה עדיין מופיע בלי שהtester ישנה — בדוק ש-`.visually-hidden` או `display:none` חל על input. כנראה זה לא bug אמיתי כי אני שיניתי.

### 🟡 B9 — FilePicker warnings

‏מתוך `/tmp/fe.log`:
```
[vite-plugin-svelte] src/lib/components/FilePicker.svelte:25:37
  This reference only captures the initial value of `initialPath`.
  Did you mean to reference it inside a closure instead?
  https://svelte.dev/e/state_referenced_locally

[vite-plugin-svelte] src/lib/components/FilePicker.svelte:51:2
  Elements with the 'dialog' interactive role must have a tabindex value
  https://svelte.dev/e/a11y_interactive_supports_focus
```

‏**Fix 1:** `let currentPath = $state(initialPath)` במקום `let currentPath = initialPath` — captures initial value reactively.
‏**Fix 2:** הוסף `tabindex="-1"` ל-`<div role="dialog">`.

### 🟡 B10 — Thought translation לא נראה

‏**מה רואים ב-bubbles:** רק הטקסט המקורי באנגלית של ה-thought ("The user is testing the system..."). אין תרגום עברי.

‏**צפוי:** לפי mockup — כל sub-segment של thought מציג original (LTR, אפור, opacity 0.5) **וגם** translation (RTL, עברית). ב-backend (Tier 1) זה מועבר ב-audio_chunk עם `originalText` + `translatedText`.

‏**איפה:** `packages/frontend/src/lib/components/SubSegment.svelte` — וודא שmrenders שניהם אם kind=thought.

‏**Reference:** `final.html` opt 9 — אופציה 9 (selected) של icon-placements.

### 🟡 B11 — אין click-to-play visual indicator

‏**מה רואים:** ה-bubbles הם button (לפי snapshot), אבל אין אינדיקציה ויזואלית שאפשר לקליק עליהם.

‏**צפוי:** לוגו "play" קטן בפינה (opacity 0.3) כשbubble idle. border מודגש כשbubble currently playing.

‏**איפה:** `BubbleKind.svelte`.

‏**Reference:** Slice 9 brief §1 #7 + שיחת ה-mockups לאחור.

### 🟡 B12 — תמלול מוזר

‏**מה רואים:** ה-Gemini STT החזיר "שלום, אני בודקת את המערכת. האם אתה שומע אותי?" — אבל ה-test-voice.mp3 הוא של ה-prompt הזה? אצטרך לבדוק. אם הקבוע נכון, מצוין. אם לא — Gemini הזה (אבל test-voice.mp3 הוא 56KB עברית, סביר שזה נכון).

---

## 4. Bugs פוטנציאליים שלא בדקתי

### Q1 — Sessions page (`/sessions`)
‏לא נבדק שעובד. ייתכן שיש bugs בטעינה (`projects-store`, `fs-browser-store`).

### Q2 — Sessions load route (`/session/[cwdHash]/[id]`)
‏לא נבדק שעובד. ה-flow: bookmark URL → page mount → fetch projects → find cwd → POST agent עם existingSessionId → redirect ל-/agent/[new].

### Q3 — File picker modal
‏לא נבדק שפותח ועובד מ-dashboard. ה-component אולי לא wired מ-"+ סוכן חדש" כראוי.

### Q4 — Settings page
‏לא נבדק. voice picker, audio cues toggle.

### Q5 — Recording playback
‏לא נבדק. כשclick על user bubble אמור fetch `/api/recordings/:id` ו-play.

### Q6 — History bubbles
‏לא נבדק. כשטוענים session ישן, history events אמורים להציג bubbles cold (לא להפעיל TTS אוטומטית).

### Q7 — Mobile vs Desktop responsive
‏ה-screenshot נראה כמו desktop layout (sidebar בצד שמאל). מובייל לא נבדק.

### Q8 — Audio playback של ה-tts
‏הbrowser זיהה audio_chunks אבל לא בדקתי שבמכשיר אמיתי שומעים אותם בקול.

---

## 5. עבודה שצריך לעשות

### Phase 1 — תיקוני critical (B1-B5)

1. ‏Bubble grouping fix (B1) — TDD: test שמראה ש-3 chunks → 1 sub-segment
2. ‏Mic double-icon (B2) — fix template
3. ‏Avatars בbubbles (B3) — וודא BubbleAvatar wired נכון
4. ‏הסרת textbox+שלח (B4)
5. ‏Header layout (B5) — RTL fix

### Phase 2 — תיקוני medium (B6-B11)

6. ‏Bottom sheet handle visibility (B6)
7. ‏Sparkles avatar שנעלם dashboard (B7)
8. ‏FilePicker warnings (B9 — 2 תיקונים)
9. ‏Thought translation display (B10)
10. ‏Click-to-play visual indicator (B11)

### Phase 3 — בדיקות + תיקוני flows שלא נבדקו (Q1-Q8)

11. ‏בדוק `/sessions` page (Q1)
12. ‏בדוק `/session/[cwdHash]/[id]` route (Q2)
13. ‏בדוק file picker modal (Q3)
14. ‏בדוק settings page (Q4)
15. ‏בדוק recording playback (Q5)
16. ‏בדוק history bubbles (Q6)
17. ‏בדוק mobile responsive (Q7)
18. ‏בדוק audio playback (Q8)

---

## 6. DoD Checklist

- [ ] כל ה-B1-B11 תוקנו, נבדקו ב-browser
- [ ] Q1-Q8 נבדקו ידנית (linux-gui + playwright); תיקנו אם יש bugs
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test` ירוקים
- [ ] tests חדשים ל-bubble grouping fix (B1) — לפחות 4 tests
- [ ] עדכון `docs/walkthrough.md` עם entry מסכם
- [ ] screenshot סופי שמראה את ה-UI הנכון (mobile + desktop)

---

## 7. אסור / מותר

**מותר:**
- ‏`packages/frontend/src/**`
- ‏`packages/backend/src/**` (אם צריך תיקון קטן)
- ‏`packages/core/src/schemas/agent.ts` (כבר תוקן)
- ‏`docs/walkthrough.md`

**אסור:**
- ‏`packages/core/src/**` חוץ מ-schemas/agent.ts ו-schemas/ws-messages.ts
- ‏`docs/reviews/**`, `docs/archive/**`
- ‏`docs/slice-9-followup-fixes.md` (זה הbrief — קרא אבל אל תערוך)

---

## 8. סקילים חובה

- ‏`tdd` — red-green-refactor loop
- ‏`dev-conventions` — Svelte 5 runes, ESM, אסור any
- ‏`Svelte-MCP` — לחיפוש docs של Svelte 5
- ‏`rtl-adaptation` — לוודא RTL נכון
- ‏`commit` — מבנה commit messages (עברית, פר-fix או פר-Phase)
- ‏`update-walkthrough` — entry בסוף

**אוטונומיה גורפת:** אבי אישר את התוכנית. אל תבקש רשות לcommit. בסוף כל
fix ירוק → typecheck/lint/test → commit אוטומטי. רק החלטה ארכיטקטונית
שלא מכוסה ב-brief → עצור ושאל.

---

## 9. Prompt לסוכן

**חובה Sonnet 4.6** — לא Opus.

```
אתה סוכן תיקון bugs של drive-coding frontend. Slice 9 הושלם אבל יש bugs
חזותיים חמורים. תפקידך לתקן את הכל.

נתיבים:
- worktree (CWD): /home/user/projects/voice-acp-v2
- mockup: https://your-app-mockups.nue.tuns.sh/final.html
  + קבצים: /tmp/drive-coding-mockups/final.html + shared.css
- v1 reference: /home/user/projects/voice-acp/frontend/index.html

מקור אמת: docs/slice-9-followup-fixes.md (קרא קצה-לקצה לפני שמתחילים).

עבודה:
1. טען skills: tdd, dev-conventions, Svelte-MCP, rtl-adaptation,
   commit, update-walkthrough.
2. קרא את ה-brief מקצה לקצה.
3. קרא את הקבצים הרלוונטיים:
   - packages/frontend/src/lib/stores/agent-session.svelte.ts (B1 — bubble grouping)
   - packages/frontend/src/lib/components/MicCluster.svelte (B2 — double mic)
   - packages/frontend/src/lib/components/BubbleAvatar.svelte (B3)
   - packages/frontend/src/lib/components/BubbleKind.svelte (B3, B10, B11)
   - packages/frontend/src/lib/components/SubSegment.svelte (B10)
   - packages/frontend/src/lib/components/FloatingHeader.svelte (B5)
   - packages/frontend/src/lib/components/BottomSheet.svelte (B6)
   - packages/frontend/src/lib/components/FilePicker.svelte (B9)
   - packages/frontend/src/routes/agent/[id]/+page.svelte (B4)
   - packages/frontend/src/routes/+page.svelte (B7)
4. קרא את mockup: /tmp/drive-coding-mockups/final.html + shared.css.
5. בצע לפי Phase 1 → 2 → 3 בסדר. TDD חובה ל-logic.
6. commit פר fix או פר Phase. פורמט עברי.
7. בסוף — עדכן docs/walkthrough.md.

pnpm typecheck + pnpm lint + pnpm test לפני כל commit.

אסור לערוך: packages/core/src/** חוץ מ-schemas/agent.ts ו-schemas/ws-messages.ts,
docs/reviews/**, docs/archive/**, docs/slice-9-followup-fixes.md.

ה-backend רץ ברקע ב-tmux `be` על port 4000. ה-frontend ב-tmux `fe` על
port 5173. tunnel: https://your-app.nue.tuns.sh

לטסט ב-browser: linux-gui עם pw-clean.sh על port 9333. test-voice.mp3
על /tmp/test-voice.mp3 ועל linux-gui:/tmp/test-voice.mp3.

לטסט upload — input #audio-file-input מוסתר. כדי לחשוף ידנית:
  playwright-cli eval "(() => { document.querySelector('#audio-file-input').style.cssText = 'position:fixed;top:10px;z-index:9999;display:block'; })()"
ואז click + upload.

יצרת agent עם cwd שתבחר (לדוגמה /home/user/projects/voice-acp-v2)
דרך POST /api/agents עם cliKind=opencode.

אוטונומיה גורפת — בסוף כל fix ירוק → commit אוטומטי. רק החלטה
ארכיטקטונית לא מכוסה ב-brief → עצור ושאל.
```

---

## 10. סיכום צפוי

- 11 fixes (B1-B11)
- 8 בדיקות + תיקונים פוטנציאליים (Q1-Q8)
- ~15-20 commits
- ~10-20 tests חדשים (בעיקר ל-bubble grouping)
- 3-5 שעות עבודה
