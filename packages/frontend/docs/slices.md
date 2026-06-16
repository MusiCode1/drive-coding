# Slices Roadmap — frontend-v2

> **‎סטטוס**: ‎חי, ‎עדכון 2026-05-28.
> **‎תפקיד**: ‎מקור-אמת ‎יחיד לסדר ה-slices של ‎`packages/frontend-v2/`.
> **‎מחליף**: ‎`docs/frontend-reorganization-plan.md` ‎(הועבר ל-archive) ‎+ ‎חלק §8.5 ב-`docs/vnext-spec.md` (סומן obsolete).
>
> **שינוי 2026-05-28**: נוסף slice 0.5 (i18n) ושונה סדר ה-slices אחרי בדיקת ‎מסמכי ‎התכנון.
> ‎ראה §"סדר ‎ה-slices ‎— ‎נימוקים".

---

## ‎רקע ‎— ‎למה ‎יש מסמך ‎חדש

‎עד 2026-05-27 ‎הפיתוח התנהל ב-`packages/frontend/` ‎לפי `docs/vnext-spec.md` ‎(10 slices). ‎ה-slices מומשו (1-10) ‎אבל הקוד הצטבר לכאוס:
‎- ‎`agent/[id]/+page.svelte` = ‎989 ‎שורות.
‎- ‎`messages` ‎ו-`bubbles` ‎שתי מערכות מקבילות באותו store.
‎- ‎4 ‎מערכות localStorage עצמאיות.
‎- ‎Side effects פזורים ב-routes.

‎ההכרעה (2026-05-26): ‎לא refactor ב-מקום, ‎אלא **‎build-from-scratch ‎ב-`packages/frontend-v2/`** ‎עם המבנה הנקי (view-models classes + Context + 5 שכבות). ‎ראה ‎`packages/frontend-v2/AGENTS.md` ‎לחוקי הזהב.

ה-roadmap הזה מחליף את ה-10-slice roadmap הקודם בvnext-spec.

---

## ‎מקורות אמת ‎(מה לקרוא למה)

| ‎שאלה | ‎לאיזה ‎מסמך לפנות |
|------|-------------------|
| ‎עקרונות UX (drive-first, ‎car mode, ‎mic states) | ‎`docs/frontend-spec.md` |
| ‎D1-D50 ‎(החלטות ‎ארכיטקטוניות) | ‎`docs/design-principles.md §6` |
| ‎פרוטוקול BE↔FE, ‎schemas | ‎`docs/vnext-spec.md` §3-6 (§8.5 obsolete) |
| ‎ACP protocol, ‎transport-agnostic client | ‎`packages/core/src/acp/` ‎+ tests |
| ‎Behaviors checklist (feature parity) | ‎`docs/behaviors-coverage.md` |
| ‎5 ‎חוקי זהב ל-v2 | ‎`packages/frontend-v2/AGENTS.md` |
| ‎ה-slice הבא לביצוע | ‎המסמך הזה (§ ‎"slice הבא") |
| ‎פיצ'רים ‎שנדחו | ‎`docs/future-features.md` |
| ‎חוב ‎ידוע (i18n) | ‎`docs/i18n-gap-report.md` |

---

## ‎סטטוס נוכחי

```
Slice 0    ✅ הושלם   text-only chat (connect + send prompt + bubbles)
Slice 0.5  ✅ הושלם   i18n infra + lint rule + מיגרציה ‎של ~20 מחרוזות
Slice 1    ⏭️ מדולג   Mic + STT — נחזור אליו ב-slice 3 (משולב עם VoiceMode)
Slice 2    ✅ הושלם   Speaker + TTS streaming + Bubble model מורחב (2026-05-28)
Slice 3+   💭 מתוכנן  ראה ‎טבלה ‎למטה
```

---

## ‎טבלת ‎ה-slices

| # | ‎שם | ‎תוצר | ‎תלות | ‎גודל | Status |
|---|------|--------|--------|--------|--------|
| 0 | Text foundation | ‎connect + chat טקסטואלי + bubbles streaming | — | — | ✅ |
| 0.5 | **i18n infra** | ‎`core/i18n/` + ‎`t(key)` + ‎lint rule ‎+ ‎מיגרציה ‎של ~20 ‎מחרוזות ‎קיימות | 0 | ~‎חצי יום | ✅ |
| 1 | Mic + STT | ‎אישה ‎מדברת ‎→ STT ‎→ ‎sendPrompt | 0.5 | ~1 ‎יום | ⏭️ מדולג, נחזור ב-slice 3 |
| 2 | Speaker + TTS | ‎chunks ‎מסוכן ‎→ ‎TTS ‎→ ‎אודיו ‎(sentence-by-sentence) | 0.5 + Bubble model מורחב | ~‎2 ‎ימים | ✅ |
| 3 | VoiceMode FSM | ‎composite 6-state (idle/recording/transcribing/thinking/speaking/cancelling) + Mic + STT | 1, 2 | ~‎יום | ✅ |
| 8 | Session picker | inline ב-connect form — "טען סשנים", dropdown, loadSession | 0.5 | ~1 יום | ✅ (2026-05-29, inline לא /sessions route — פחות חיכוך) |
| 9 | Settings page | `/settings` ‎— ‎voice picker ‎(ElevenLabs voices), ‎audio cues toggles | 0.5, 6 | ~1 ‎יום | 💭 |
| 4 | Bubble polish | ‎markdown, ‎tool bubbles עם status dots, ‎thought styling | 0.5 | ~1 ‎יום | ✅ (2026-05-29) |
| 15 | **Backend URL config + CF deployment** | CORS env var (15a), Settings.beUrl + /settings page (15b), adapter migration (15c), CF Pages deploy guide + build verification (15d) | 0.5 | ~1 יום | ✅ (2026-05-30) |
| 16 | Tool call content | ACP faithful rendering (diff, terminal, locations, shell commands) | 4 | ~1 יום | ✅ (2026-05-29) |
| 5 | Smart scroll | ‎auto-scroll, ‎jump-down button, ‎user-interaction detection | 0 | ~‎חצי יום | 💭 |
| 6 | Audio cues | ‎5 ‎צלילים ‎ב-Web Audio (recording start/stop, thinking, speaking, error) | 3 | ~‎חצי יום | 💭 |
| 7 | Drive-first chrome | car mode (?car=1), Media Session API, wake lock, landscape lock | 1, 2, 6 | ~‎2 ‎ימים | 💭 |
| 10 | Recordings + replay | ‎שמירת הקלטות, ‎replay של שיחה מלאה (user audio + agent TTS חדש) | 1, 2, 8 + BE work | ~‎2 ‎ימים | 💭 |
| 11 | Audio-friendly prompt | ‎OpenCode plugin injection (audio-friendly system prompt) — דורש BE work | 0 | ~‎2 ‎ימים | ✅ |
| 14 | Generic prompt injector | ‎Refactor של ‎slice 11 — ‎plugin הופך ‎generic ‎(text דרך ‎options), ‎הטקסט עובר ל-`packages/backend/src/prompts/` ‎(הכנה לפרופילים מרובים / picker עתידי) | 11 | ~‎חצי יום | ✅ |
| 22 | **TTS ordering + tool narration audio** | OrderKey + OrderedQueue (fetch מקבילי בסדר נכון) + tool narration כ-TTS job + provenance על AudioSegment | 2, 4 | ~1 יום | ✅ (2026-06-01) |
| 23 | **Agent Options Panel** | ווידג'ט config סשן (model/agent/configOptions) על סשן פתוח דרך ACP setSessionConfigOption | 0.5, 8 | ~חצי יום | ✅ (2026-06-01) |
| 24 | **Client-keyed proxy cache** | מפתח cache לפי clientId — מונע דליפת cache בין sessions | BE | ~חצי יום | ✅ (2026-06-01) |
| 25 | **Bridge leak fix (FE cleanup)** | #cleanup שולח deleteAgent ב-3 מסלולי detach/attach-error/loadSession-error | FE | ~חצי יום | 💭 מאושר, ממתין dispatch |
| 26 | **Idle-bridge reaper (BE)** | setInterval reaper שמנקה bridges ללא WS פעיל — רשת ביטחון עד future A | BE | ~חצי יום | ✅ הוסר ב-slice-remove-idle-reaper (2026-06-16) |
| ws-r-infra | **WS reconnect infra** | AgentSession: warm-first reconnect, cold fallback, MED-8 retry, backoff 5×, visibility tracking. VM + adapter בלבד — אפס UI | 26 | ~1 יום | ✅ (2026-06-03) — depends_on: [] |
| ws-r-ui | **WS reconnect UI** ⏳ JIT | כפתור + חיווי reconnect, banner, i18n — slice עוקב בנפרד | ws-r-infra | ~חצי יום | 💭 JIT — כתיבה אחרי אימות infra |
| 13 | Cutover | rename ‎`frontend-v2/` ‎→ ‎`frontend/` ‎(הישן ‎כבר נמחק ‎ב-2026-05-28) | כל ‎הקודמים | ~‎חצי יום | 💭 |

**‎סה"כ ‎לcutover מלא: ‎~‎15-16 ‎ימי עבודה.**
**‎סה"כ ‎ל-"כלי ‎יומיומי ‎שמיש" ‎(slices 0.5 + 1-3 + 8-9): ‎~‎5 ‎ימים.**

---

## ‎סדר ‎ה-slices ‎— ‎נימוקים

ה-roadmap המקורי היה ‎1→2→3→4→5→6→7→8→9→10→11→12. ‎שינויים ‎ב-2026-05-28:

### 1. ‎הוספת ‎slice 0.5 ‎(i18n) ‎לפני slice 1

‎ה-`i18n-gap-report.md` (‎הועבר ‎לארכיון) ‎תיעד ‎את ה-anti-pattern שקרה ‎ב-FE ‎הישן: ‎D10 ‎הצהיר ‎"אין hardcoded strings" ‎אבל ה-slice של i18n נדחה ‎שוב ‎ושוב, ‎ובסוף ‎הצטברו ‎150 ‎מחרוזות ‎ב-21 קבצים. **‎ב-v2 ‎ב-slice 0 ‎יש רק ~20 ‎מחרוזות** — ‎עלות ‎חילוץ ‎נמוכה ‎פי 7-10 ‎מאשר ‎בסוף slice 11.

‎בנוסף ל-extraction: lint rule (Biome/grep ‎ב-pre-commit) ‎שחוסם ‎`[\u0590-\u05FF]` ‎בקוד ‎מחוץ ‎ל-catalog ‎ו-prompts. ‎בלי lint rule, ‎כל slice עתידי יכניס מחרוזות עבריות ‎חדשות ‎ויעקור ‎את ‎המאמץ.

### 2. ‎דחיפת slices 8-9 ‎(Session picker + Settings) ‎לפני 4-7

‎אחרי slices 1-3 ‎יש ‎voice in/out ‎עובד. ‎השאלה ‎הבאה ‎של המשתמש היא "‎איך ‎אני ‎חוזר ‎לסשן ‎שעבדתי ‎עליו ‎אתמול" ‎ו-"‎איך ‎אני ‎בוחר ‎קול", ‎לא "‎הbubbles ‎יפים ‎יותר". ‎סדר ‎4-7 ‎הוא ‎polish — ‎חשוב ‎אבל ‎לא ‎חוסם ‎שימוש ‎יומיומי.

### 3. ‎slice 12 ‎(i18n) ‎הוסר ‎— ‎הוחלף ב-0.5

‎ה-roadmap המקורי שמר i18n ‎ל-slice 12 ‎(לפני cutover). ‎זה ‎בדיוק ‎הדפוס ‎שיצר ‎את ‎הבעיה ב-v1. ‎מבוטל ל-טובת ‎0.5.

### 4. ‎הוספת ‎"Bubble model ‎מורחב" ‎כתלות ‎של ‎slice 2

‎לפי **חוק ‎זהב #5** ‎ב-`AGENTS.md` ‎(אסור backward compat in place), ‎שינוי ‎ה-state model ‎של ‎`bubbles` ‎צריך ‎להיעשות ‎במכה ‎אחת ‎ולא ‎בהדרגה. ‎ה-bubble ‎השטוח ‎הנוכחי (`{ id, kind, text }`) ‎לא ‎מספיק ‎ל-slice 2 (‎צריך ‎segments ל-streaming TTS), ‎slice 4 (tool bubbles ‎עם ‎status), ‎ו-slice 10 (recordingId ‎ב-user bubbles). ‎ראה ‎`docs/bubble-model.md` ‎להחלטה.

---

## ‎פירוט slices ‎— ‎סקירה ‎(לא ‎brief מלא)

### Slice 0.5 ‎— i18n infrastructure

**‎מטרה**: ‎לפתור ‎את ‎D10 ‎לפני ‎שהמחרוזות ‎יצטברו ‎שוב.

**‎נגיעות** (5 ‎חדשים + 3 ‎שינויים):

‎חדשים:
- ‎`packages/core/src/i18n/keys.ts` — `MessageKey` type (union ‎של ‎מפתחות), `Locale` type.
- ‎`packages/core/src/i18n/catalogs/he.ts` — ‎עברית ‎(ברירת ‎מחדל).
- ‎`packages/core/src/i18n/catalogs/en.ts` — ‎אנגלית ‎(scaffold ‎בלבד, ‎יושלם ‎עתידי).
- ‎`packages/core/src/i18n/index.ts` — ‎`createI18n({ locale })` → `{ t, setLocale, locale }`.
- ‎`packages/frontend-v2/src/lib/view-models/i18n.svelte.ts` — VM ‎עוטף ‎עם ‎`$state` ‎ל-locale.
- ‎`scripts/lint-no-hebrew-in-code.sh` (‎או ‎Biome custom rule) — ‎חוסם ‎`[\u0590-\u05FF]` ‎ב-`*.ts`/`*.svelte` ‎מחוץ ‎ל-catalogs ‎ו-prompts ‎ב-`core/voice/`.

‎שינויים:
- ‎`+layout.svelte` ‎— ‎יצירת `i18n` ‎VM ‎+ ‎setContext.
- ‎`+page.svelte` ‎ו-`chat/+page.svelte` ‎— ‎החלפת ‎כל ‎מחרוזת ‎עברית ‎ב-`t(...)`.
- ‎`agent-session.svelte.ts` ‎— ‎הודעות ‎שגיאה ‎דרך ‎`t(...)`. ‎אם ‎ה-VM ‎לא ‎יכול ‎לגשת ‎ל-context, ‎להחזיר ‎message key במקום ‎טקסט ‎והroute ‎יתרגם.

**Locale detection**: `navigator.language` → ‎עברית אם he, ‎אחרת ‎אנגלית. ‎אופציה ‎לדריסה ‎ב-Settings (‎יושלם ‎ב-slice 9).

**Lint enforcement**: ‎`scripts/lint-no-hebrew-in-code.sh` ‎פותח את ‎הקובץ, ‎מסנן ‎שורות ‎שמתחילות ‎ב-`//` ‎או ‎`*` ‎(הערות), ‎ובודק ‎`[\u0590-\u05FF]`. ‎whitelist: ‎`packages/core/src/i18n/catalogs/`, ‎`packages/core/src/voice/*prompt.ts` (LLM ‎prompts), ‎`docs/**`.

**DoD**:
- ‎`pnpm exec ./scripts/lint-no-hebrew-in-code.sh` ‎יוצא 0.
- ‎כל ‎ה-FE-v2 ‎הקיים ‎פועל ‎אותו ‎דבר ‎(connect + chat). ‎אישור ‎ידני.
- ‎`pnpm typecheck` ‎ירוק.
- ‎ה-script ‎רץ ‎ב-CI / pre-commit (‎עדיף).

### Slice 1 ‎— Mic + STT

‎ראה `packages/frontend-v2/AGENTS.md` §slice 1 ‎לפירוט מלא. ‎שמונה ‎נגיעות: ‎5 ‎חדשים (Recorder engine, ‎sdks adapter, ‎transcribe adapter, ‎Mic view-model, ‎MicButton component), ‎3 ‎שינויים (context, ‎layout, ‎chat route).

### Slice 2 ‎— Speaker + TTS

‎ה-pipeline ‎ההפוך ‎של ‎Slice 1. ‎Speaker מקבל chunks מ-AgentSession, ‎מפצל למשפטים ‎(`core/voice/sentence-boundary`), ‎מתרגם thoughts ‎(`core/voice/translate-cache` + ‎`@drive-coding/core/voice/translation-prompt`), ‎ומסנתז TTS ‎(ElevenLabs eleven_v3). ‎AudioStream engine מנהל ‎MediaSource ‎ל-streaming playback.

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

### Slice 13 ‎— Cutover

‎אחרי ‎שcomponent parity מוצא: ‎`mv packages/frontend-v2/ packages/frontend/`. ‎עדכון ‎package.json, ‎pnpm-workspace.yaml, ‎scripts, ‎vitest.config. ‎merge ‎ל-main (‎ב-merge ‎הענף ‎הישן ‎ימחק ‎אוטומטית — ‎הוא ‎לא ‎קיים ‎ב-`dev`).

---

## ‎פיצ'רים ‎שנדחים (לא במסגרת ‎ה-roadmap הזה)

| ‎פיצ'ר | ‎סיבה לדחייה | ‎מקור |
|--------|---------------|--------|
| ‎Thought voice ‎(קול שני למחשבות) | ‎לא דחוף | `docs/future-features.md` |
| ‎VAD + ‎Gemini interrupt | ‎מורכב מאוד, ‎דורש POC נפרד | ‎`docs/future-features.md` |
| ‎Permission UI (voice + click) | ‎yolo mode עובד | ‎`docs/future-features.md` |
| ‎Replay nav buttons (⏮/⏭) | ‎נחמד, ‎לא ‎חיוני | ‎`docs/archive/v1/plan.md` משימה Q |
| ‎Wake word | ‎דורש POC נפרד | ‎`docs/vnext-planning.md` Q11 |
| ‎Multi-tenant / auth | ‎אישה ‎יחידה ‎(D11) | ‎`docs/vnext-planning.md` |
| ‎Mobile/Desktop builds | ‎web בלבד ב-v2 | — |

---

## ‎איך מתחילים slice חדש

‎לפי `packages/frontend-v2/AGENTS.md` §‎"לפני שמוסיפים פיצ'ר חדש":

1. ‎קרא ‎את ‎השורה ‎של ‎ה-slice בטבלה.
2. ‎פתח ‎את ‎ה-`packages/frontend-v2/AGENTS.md` ‎— ‎ודא ‎שכל 5 ‎חוקי הזהב ברורים.
3. ‎פתח ‎את ‎ה-spec ‎הרלוונטי ‎(`frontend-spec.md` §X) ‎לפרטים ‎על העיצוב.
4. ‎הכן ‎brief קצר (10-30 שורות) ‎שמפרט ‎את ‎ה-8 ‎נגיעות (בערך 5 ‎חדש + ‎3 ‎שינויים) — ‎כמו ‎שעשינו ‎עם slice 1.
5. ‎בצע. ‎typecheck ‎ירוק לפני כל commit. ‎בדיקה ידנית של החוויה ‎ב-tunnel.
6. ‎עדכן ‎את ‎ה-Status ‎בטבלה ‎(`💭` → `🔄 בעבודה` → `✅`).

---

## ‎עדכונים ‎לעתיד ‎של המסמך ‎הזה

‎להוסיף ‎טור ב-טבלה ‎"מספר commits" ‎אחרי שmid-cutover. ‎להוסיף ‎הערות ‎על ‎סטיות ‎מהתכנון.

‎אם slice מתחלק לשניים — ‎לעדכן ‎ב-טבלה ‎(לא לכתוב את ‎ה-roadmap מחדש).

‎אם פיצ'ר ‎נדחה — ‎להעבירו לטבלת "‎נדחים" ‎עם סיבה.
