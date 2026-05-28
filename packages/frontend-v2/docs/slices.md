# Slices Roadmap — frontend-v2

> **‏‎סטטוס**: ‎חי, ‎עדכון 2026-05-27.
> **‏‎תפקיד**: ‎מקור-אמת ‎יחיד לסדר ה-slices של ‎`packages/frontend-v2/`.
> **‏‎מחליף**: ‎`docs/frontend-reorganization-plan.md` ‎(הועבר ל-archive) ‎+ ‎חלק §8.5 ב-`docs/vnext-spec.md` (סומן obsolete).

---

## ‏‎רקע ‎— ‎למה ‎יש מסמך ‎חדש

‎עד 2026-05-27 ‎הפיתוח התנהל ב-`packages/frontend/` ‎לפי `docs/vnext-spec.md` ‎(10 slices). ‏‎ה-slices מומשו (1-10) ‎אבל הקוד הצטבר לכאוס:
‎- ‎`agent/[id]/+page.svelte` = ‎989 ‎שורות.
‎- ‎`messages` ‎ו-`bubbles` ‎שתי מערכות מקבילות באותו store.
‎- ‎4 ‎מערכות localStorage עצמאיות.
‎- ‎Side effects פזורים ב-routes.

‎ההכרעה (2026-05-26): ‎לא refactor ב-מקום, ‎אלא **‎build-from-scratch ‎ב-`packages/frontend-v2/`** ‎עם המבנה הנקי (view-models classes + Context + 5 שכבות). ‎ראה ‎`packages/frontend-v2/AGENTS.md` ‎לחוקי הזהב.

ה-roadmap הזה מחליף את ה-10-slice roadmap הקודם בvnext-spec.

---

## ‏‎מקורות אמת ‎(מה לקרוא למה)

| ‎שאלה | ‎לאיזה ‎מסמך לפנות |
|------|-------------------|
| ‎עקרונות UX (drive-first, ‎car mode, ‎mic states) | ‎`docs/frontend-spec.md` |
| ‎D1-D50 ‎(החלטות ‎ארכיטקטוניות) | ‎`docs/vnext-architecture.md` |
| ‎פרוטוקול BE↔FE, ‎schemas | ‎`docs/vnext-spec.md` §3-6 (§8.5 obsolete) |
| ‎ACP protocol, ‎transport-agnostic client | ‎`packages/core/src/acp/` ‎+ tests |
| ‎Behaviors checklist (feature parity) | ‎`docs/behaviors-coverage.md` |
| ‎5 ‎חוקי זהב ל-v2 | ‎`packages/frontend-v2/AGENTS.md` |
| ‎ה-slice הבא לביצוע | ‎המסמך הזה (§ ‎"slice הבא") |
| ‎פיצ'רים ‎שנדחו | ‎`docs/future-features.md` |
| ‎חוב ‎ידוע (i18n) | ‎`docs/i18n-gap-report.md` |

---

## ‏‎סטטוס נוכחי

```
Slice 0  ✅ הושלם   text-only chat (connect + send prompt + bubbles)
Slice 1  📋 הבא     Mic + STT (אישה ‎מדברת)
Slice 2  💭 מתוכנן  Speaker + TTS (סוכן מדבר)
Slice 3+ 💭 מתוכנן  ראה ‎טבלה ‎למטה
```

---

## ‏‎טבלת ‎ה-slices

| # | ‎שם | ‎תוצר | ‎תלות | ‎גודל | Status |
|---|------|--------|--------|--------|--------|
| 0 | Text foundation | ‎connect + chat טקסטואלי + bubbles streaming | — | — | ✅ |
| 1 | Mic + STT | ‎אישה ‎מדברת ‎→ STT ‎→ ‎sendPrompt | 0 | ~1 ‎יום | 📋 הבא |
| 2 | Speaker + TTS | ‎chunks ‎מסוכן ‎→ ‎TTS ‎→ ‎אודיו ‎(sentence-by-sentence) | 0, 1 | ~‎2 ‎ימים | 💭 |
| 3 | VoiceMode FSM | ‎composite 5-state (idle/recording/transcribing/thinking/speaking) | 1, 2 | ~‎חצי יום | 💭 |
| 4 | Bubble polish | ‎markdown, ‎tool bubbles עם status dots, ‎thought styling | 0 | ~1 ‎יום | 💭 |
| 5 | Smart scroll | ‎auto-scroll, ‎jump-down button, ‎user-interaction detection | 0 | ~‎חצי יום | 💭 |
| 6 | Audio cues | ‎5 ‎צלילים ‎ב-Web Audio (recording start/stop, thinking, speaking, error) | 3 | ~‎חצי יום | 💭 |
| 7 | Drive-first chrome | car mode (?car=1), Media Session API, wake lock, landscape lock | 1, 2, 6 | ~‎2 ‎ימים | 💭 |
| 8 | Session picker | `/sessions` ‎— ‎רשימת sessions ישנים, ‎resume | 0 | ~1 ‎יום | 💭 |
| 9 | Settings page | `/settings` ‎— ‎voice picker ‎(ElevenLabs voices), ‎audio cues toggles | 6 | ~1 ‎יום | 💭 |
| 10 | Recordings + replay | ‎שמירת הקלטות, ‎replay של שיחה מלאה (user audio + agent TTS חדש) | 1, 2, 8 | ~‎2 ‎ימים | 💭 |
| 11 | Audio-friendly prompt | ‎OpenCode plugin injection (audio-friendly system prompt) | 0 | ~‎2 ‎ימים | 💭 |
| 12 | i18n infrastructure | ‎message catalogs, ‎locale loading, ‎אנגלית אופציונלית | — | ~‎2 ‎ימים | 💭 |
| 13 | Cutover | ‎מחיקת `packages/frontend/`, rename `frontend-v2/` → `frontend/` | 1-11 | ~‎חצי יום | 💭 |

**‏‎סה"כ ‎לcutover מלא: ‎~‎15 ‎ימי עבודה.**
**‏‎סה"כ ‎ל-MVP ‎(slices 1-3 + 4-5): ‎~‎5 ‎ימים.**

---

## ‏‎פירוט slices ‎— ‎סקירה ‎(לא ‎brief מלא)

### Slice 1 ‎— Mic + STT

‎ראה `packages/frontend-v2/AGENTS.md` §slice 1 ‎לפירוט מלא. ‎שמונה ‎נגיעות: ‎5 ‎חדשים (Recorder engine, ‎sdks adapter, ‎transcribe adapter, ‎Mic view-model, ‎MicButton component), ‎3 ‎שינויים (context, ‎layout, ‎chat route).

### Slice 2 ‎— Speaker + TTS

‎ה-pipeline ‎ההפוך ‎של ‎Slice 1. ‏‎Speaker מקבל chunks מ-AgentSession, ‎מפצל למשפטים ‎(`core/voice/sentence-boundary`), ‎מתרגם thoughts ‎(`core/voice/translate-cache` + ‎`@drive-coding/core/voice/translation-prompt`), ‎ומסנתז TTS ‎(ElevenLabs eleven_v3). ‎AudioStream engine מנהל ‎MediaSource ‎ל-streaming playback.

‎מתבסס ‎על האדריכלות שכבר מומשה ‎ב-`packages/frontend/src/lib/voice/orchestrator.ts` ‎(417 ‎שורות) — ‎אבל ‎עם החוקים החדשים ‎(לא orchestrator factory, ‎אלא ‎Speaker class).

### Slice 3 ‎— VoiceMode FSM

‎Derived view-model ‎(`view-models/derived/voice-mode.svelte.ts`) ‎שמסכם ‎Mic + AgentSession + Speaker ‎לstate אחד ‎(`idle` / `recording` / `transcribing` / `thinking` / `speaking` / `cancelling`).

‎ה-MicButton component משתמש בו ‎(במקום ב-mic + session ישירות). ‎ראה ‎`frontend-spec.md §5` ‎ל-state machine ‎+ ‎צבעים + ‎אנימציות.

### Slice 4 ‎— Bubble polish

‎בועות נראות יפה. ‎מ-`frontend-spec.md §7`:
‎- ‎markdown rendering ב-message bubbles (`@drive-coding/core/ui/markdown`).
‎- ‎thought bubbles ‎עם `💭` ‎prefix + ‎dashed border + ‎italic.
‎- ‎tool bubbles collapsible עם status dots (pending/in_progress/completed/failed).
‎- ‎RTL alignment ‎(user ימין, ‎agent שמאל).
‎- ‎asymmetric border-radius.

### Slice 5 ‎— Smart scroll

‎`util/scroll-derive.ts` ‎(pure function, ‎port מ-FE הקיים) ‎+ component ‎(`<ChatScrollContainer>`) ‎שמקבל ‎את ‎ה-bubbles ‎ומנהל auto-scroll + jump-down button.

‎ראה ‎`frontend-spec.md §8`.

### Slice 6 ‎— Audio cues

‎5 ‎צלילים מסונתזים ‎עם Web Audio API ‎(oscillator):
‎- ‎recordingStart (A5, 120ms)
‎- ‎recordingStop (E5, 120ms)
‎- ‎thinking (C5→E5 rising, 300ms)
‎- ‎speaking (E5→C5 falling, 300ms)
‎- ‎error (E4→A3, 400ms)

‎`util/cues.ts` (engine קטן) ‎+ ‎`$effect` ‎ב-VoiceMode listener ‎שמפעיל cue ‎ב-state transitions.

‎ראה ‎`frontend-spec.md §10`.

### Slice 7 ‎— Drive-first chrome

‎הפיצ'ר ‎הכי שאפתני. ‎חמישה ‎sub-features:
‎- ‎`?car=1` ‎URL param ‎→ ‎`<CarModeBadge />` + ‎confirm button.
‎- ‎`view-models/car-mode.svelte.ts` ‎— ‎Media Session API integration (play/pause/previoustrack handlers).
‎- ‎AudioContext + ‎background noise ‎(gain=0.015) ‎— ‎מחזיק MediaSession פעיל.
‎- ‎Wake lock בזמן recording.
‎- ‎Landscape lock ‎(`screen.orientation.lock`).

‎ראה ‎`frontend-spec.md §11-12`.

### Slice 8 ‎— Session picker

‎`/sessions` ‎route חדש. ‎נטען ‎ב-app start. ‎מציג ‎sessions ישנים ‎(שלוף ‎דרך `listSessionsViaActiveAgent` ‎אחרי ‎connect, ‎או cache ‎ב-localStorage). ‎בחירת session ‎→ ‎`session.loadSession(sid)` ‎(API ‎ציבורי חדש שצריך להוסיף ל-AgentSession) ‎→ ‎goto /chat.

‎ראה דיון ‎ב-`frontend-reorganization-plan.md` §17 ‎(הועבר ‎לארכיון אבל ‎עוד רלוונטי לזרימה).

### Slice 9 ‎— Settings page

‎`/settings` ‎route. ‎שני stores ‎ב-Settings ‎view-model:
‎- ‎voice picker — ‎שלוף דינמית מ-`GET /v1/voices` ‎של ElevenLabs ‎(דרך ‎OneCLI gateway).
‎- ‎audio cues toggles (4 ‎checkboxes).

‎ראה ‎`vnext-spec.md §5.2` ‎לAPI של providers.

### Slice 10 ‎— Recordings backup + replay

‎הפיצ'ר ‎שביקשת ‎ב-2026-05-18. ‎דורש:
‎- ‎BE: ‎הוספת sessionId ל-RecordingsStore (`save(blob, mimeType, sessionId)`) + ‎הוספת ‎`GET /api/sessions/:id/recordings`.
‎- ‎FE: ‎`Mic.stop()` ‎מעביר recordingId לMessage.sendPrompt; ‎AgentSession.sendPrompt ‎שומר ב-bubble.
‎- ‎FE: ‎`replay()` ‎action ‎שמחזיר אחורה ‎ב-bubbles, ‎מנגן user recording (מ-BE) ‎ואז יוצר TTS חדש לתגובות סוכן (on-the-fly).
‎- ‎ב-session restore: ‎`GET /api/sessions/:id/recordings` ‎+ ‎הצמדה ל-user bubbles לפי סדר.

‎ראה ‎`frontend-reorganization-plan.md` §13 ‎(בארכיון) ‎לפירוט. ‎יש ‎שאלות פתוחות: ‎sidecar JSON vs DB ל-association.

### Slice 11 ‎— Audio-friendly prompt injection

‎הזרקת ‎system prompt ‎ל-opencode plugin שמורה ‎לCLI לפלוט פרוזה ידידותית-לאודיו ‎(בלי markdown, emojis, URLs).

‎מתבצע ‎ב-`OPENCODE_CONFIG_CONTENT` env var ‎ב-spawn (‎עוקף את ‎ה-cwd ‎של ‎המשתמשת).

‎ראה ‎`docs/audio-friendly-prompt-plan.md` ‎לתכנון מלא ‎— ‎8 ‎פסקאות, ‎כולל ‎חלופות שנשללו ‎והטמעה ב-CodeNomad כ-reference.

### Slice 12 ‎— i18n infrastructure

‎פותר חוב ‎שתועד ‎ב-D10 ‎(2026-05-15) ‎שלא ‎יושם. ‎כיום ~‎150 hardcoded Hebrew strings ‎ב-FE.

‎יוצרים:
‎- ‎`packages/core/src/i18n/` ‎עם locale catalogs (he, en).
‎- ‎`view-models/i18n.svelte.ts` ‎עם ‎`t(key)` ‎function ‎ו-locale state.
‎- ‎הזזת ‎כל ‎ה-strings ‎ב-FE ל-catalogs.

‎ראה ‎`docs/i18n-gap-report.md` ‎— ‎דוח מלא של הפער.

### Slice 13 ‎— Cutover

‎אחרי ‎שcomponent parity מוצא: ‎`git rm -r packages/frontend/` ‎+ ‎`mv packages/frontend-v2/ packages/frontend/`. ‎עדכון ‎package.json, ‎pnpm-workspace.yaml, ‎scripts. ‎ביטול ‎branch ‎`experiment/frontend-v2`. ‎merge ל-main.

---

## ‏‎פיצ'רים ‎שנדחים (לא במסגרת ‎ה-roadmap הזה)

| ‎פיצ'ר | ‎סיבה לדחייה | ‎מקור |
|--------|---------------|--------|
| ‎Thought voice ‎(קול שני למחשבות) | ‎לא דחוף | `docs/future-features.md` |
| ‎VAD + ‎Gemini interrupt | ‎מורכב מאוד, ‎דורש POC נפרד | ‎`docs/future-features.md` |
| ‎Permission UI (voice + click) | ‎yolo mode עובד | ‎`docs/future-features.md` |
| ‎Replay nav buttons (⏮/⏭) | ‎נחמד, ‎לא ‎חיוני | ‎`docs/archive/v1/plan.md` משימה Q |
| ‎Wake word | ‎דורש POC נפרד | ‎`docs/vnext-architecture.md` Q11 |
| ‎Multi-tenant / auth | ‎אישה ‎יחידה ‎(D11) | ‎`docs/vnext-architecture.md` |
| ‎Mobile/Desktop builds | ‎web בלבד ב-v2 | — |

---

## ‏‎איך מתחילים slice חדש

‎לפי `packages/frontend-v2/AGENTS.md` §‎"לפני שמוסיפים פיצ'ר חדש":

1. ‎קרא ‎את ‎השורה ‎של ‎ה-slice בטבלה.
2. ‎פתח ‎את ‎ה-`packages/frontend-v2/AGENTS.md` ‎— ‎ודא ‎שכל 5 ‎חוקי הזהב ברורים.
3. ‎פתח ‎את ‎ה-spec ‎הרלוונטי ‎(`frontend-spec.md` §X) ‎לפרטים ‎על העיצוב.
4. ‎הכן ‎brief קצר (10-30 שורות) ‎שמפרט ‎את ‎ה-8 ‎נגיעות (בערך 5 ‎חדש + ‎3 ‎שינויים) — ‎כמו ‎שעשינו ‎עם slice 1.
5. ‎בצע. ‎typecheck ‎ירוק לפני כל commit. ‎בדיקה ידנית של החוויה ‎ב-tunnel.
6. ‎עדכן ‎את ‎ה-Status ‎בטבלה ‎(`💭` → `🔄 בעבודה` → `✅`).

---

## ‏‎עדכונים ‎לעתיד ‎של המסמך ‎הזה

‎להוסיף ‎טור ב-טבלה ‎"מספר commits" ‎אחרי שmid-cutover. ‎להוסיף ‎הערות ‎על ‎סטיות ‎מהתכנון.

‎אם slice מתחלק לשניים — ‎לעדכן ‎ב-טבלה ‎(לא לכתוב את ‎ה-roadmap מחדש).

‎אם פיצ'ר ‎נדחה — ‎להעבירו לטבלת "‎נדחים" ‎עם סיבה.
