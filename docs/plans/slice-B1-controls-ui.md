# Slice B1 — UI בקרת השמעה + ריצה — תוכנית

> **תאריך**: 2026-06-28
> **סטטוס**: 🔧 תוקן לפי אביגיל r1 (3🟡+1🟢 — נתיב engines, MicLarge, A5-כבר-מוזג, מיקום carry) → ממתין re-verify
> **Complexity**: 6/10 (verifier: heavy — UI חי + RTL + נייד)
> **תלות**: [A4] (+ A5 אופציונלי ל‑turnInterrupted) · **base**: branch `slice/playback-core-a4`
> **worktree נפרד** (UI) — מאפשר merge של התשתית (A2‑A5) בלי ה‑UI.
> **שייך ל**: `docs/plans/playback-run-control-roadmap.md` (UI, אחרי השרשרת)
>
> ⚠️ **carry מ-A4 (calev-heavy — 2 edge-cases דרגה-נמוכה שה-UI חושף):**
> 1. **לחיצה על בועה-שכבר-בפלייליסט אחרי שהזרם החי הסתיים** → `jumpToBubble` הוא **no-op שקט**
>    (`if(!#playing) return`), אבל `playingBubbleId` (שדה ב-**`bubble-player.svelte.ts:37`**) מתעדכן ללא
>    תנאי → ה-UI יראה "מתנגן" בלי שמע. **התיקון ב-`bubble-player.svelte.ts:103-110`** (לא ב-engine, אביגיל #4):
>    כשלוחצים בועה in-playlist+done ו-`#playing===false` → **להתחיל ניגון מחדש** (לא רק jump).
> 2. **`next()`/`prev()` בזמן ש-current עדיין `reserved`** (טוען) → לא תקיעה, אבל latency-glitch
>    אפשרי בלחיצות-מהירות-בזמן-טעינה. שקול debounce/disable על הכפתורים בזמן loading, או קבל את ה-glitch.

## §0 — Pre-flight

### Worktree (נפרד — UI)
```bash
# ✅ ה-base כבר קיים (מרדכי הכין): worktree slice/playback-ui = A4 ממוזג עם A5 (tip 56c3a55).
# turnInterrupted (agent-session:142) קיים ב-base → Commit 2 (חיווי) **אינו אופציונלי** (אביגיל #3).
# (אם בכל זאת מקימים מחדש: git worktree add .worktrees/playback-ui -b slice/playback-ui slice/playback-core-a4 ; ואז merge --no-ff slice/playback-core-a5)
cd .worktrees/playback-ui   # קיים + install+hooks+svelte-kit-sync הורצו
```

### Run / Browser
- BE עם `onecli run --agent voice-acp`; FE; **אימות חי חובה** ב‑Chrome + linux‑gui/נייד
  (RTL + כפתורים גדולים hands‑free). tunnel אם בודקים בטלפון.

### Reading list
**must-read**:
- `packages/frontend/src/lib/components/chat/StatusBubble.svelte` — נקודת התצוגה הקיימת.
- `packages/frontend/src/lib/view-models/derived/model-status.svelte.ts` — `phase`.
- `packages/frontend/src/lib/view-models/derived/voice-mode.svelte.ts` — `stopPlayback`/`cancelRun` (A3).
- `packages/frontend/src/lib/engines/audio-playlist.svelte.ts` — `pause`:162/`resume`:171/`next`:196/`prev`:207/`jumpTo`:220/`jumpToBubble`:229/`transport`:56 (A3/A4). ⚠️ engines/ לא view-models/ (אביגיל #1).
- `packages/frontend/src/lib/context.ts` — `getModelStatus`/`getAudioPlaylist`/`getVoiceMode`.
- `packages/frontend/AGENTS.md` — חמשת חוקי הזהב.
- `docs/frontend-spec.md` — drive‑first, car mode, גדלים hands‑free.
- skill `rtl-adaptation` — logical classes (כל הכפתורים).

## §1 — מטרה

אחרי הסבב: למשתמש יש בקרה מלאה ונגישה‑בנהיגה — כשהמודל פעיל מופיע **עצור ריצה**
(טקסט/אייקון לפי thinking/עונה/פעולה), וכשמקריאים מופיעים **⏹ עצור · ⏸/▶ השהה · ⏮ קודם
· ⏭ הבא**. כל הכפתורים מחווטים לפעולות התשתית (A1‑A5). hands‑free: כפתורים גדולים, RTL נכון.

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| כפתורי השמעה ⏹/⏸▶/⏮/⏭ (phase=speaking/pending‑tts) | ✅ | — |
| כפתור עצור‑ריצה (thinking/responding/calling‑tool) | ✅ | — |
| טקסט/אייקון לפי phase | ✅ | — |
| i18n keys לכל המחרוזות | ✅ | — |
| חיווי turnInterrupted (A5) | ✅ (מינימלי) | — |
| לוגיקת playback/cancel חדשה | ❌ | A1‑A5 (רק מחווטים) |
| car‑mode מלא / Media Session | ❌ | roadmap Track C |

## §3 — Architecture diagram

```
StatusBubble.svelte (מורחב) או PlaybackControls.svelte חדש
  phase=thinking/responding/calling-tool → [⏹ עצור ריצה]  → voiceMode.cancelRun()
  phase=speaking/pending-tts            → [⏹][⏸/▶][⏮][⏭]
       ⏹ → voiceMode.stopPlayback()
       ⏸/▶ → playlist.pause()/resume()  (לפי transport)
       ⏮/⏭ → playlist.prev()/next()
  turnInterrupted → חיווי קצר (אופציונלי)
  קורא getContext: ModelStatus, VoiceMode, AudioPlaylist

i18n: core/src/i18n/keys.ts + catalogs/he.ts + en.ts  (playbackControls.*)
```

## §4 — Commits

### Commit 0 — i18n keys (approach: manual)

**קבצים שמשתנים**: `packages/core/src/i18n/keys.ts`, `catalogs/he.ts`, `catalogs/en.ts`

- `playbackControls.stopRun` ("עצור"), `.stopPlayback`, `.pause`, `.resume`, `.prev`, `.next`,
  `.interrupted` ("התור נקטע"). aria‑labels לכל כפתור.

**Verification**: `pnpm --filter core test` + `pnpm lint:i18n`.

### Commit 1 — קומפוננטת בקרה (approach: manual, browser)

**קבצים חדשים**: `packages/frontend/src/lib/components/chat/PlaybackControls.svelte`
**קבצים שמשתנים**: `StatusBubble.svelte` (מרנדר את הבקרה לצד ה‑label)

- קורא `getModelStatus()`, `getVoiceMode()`, `getAudioPlaylist()`.
- רינדור מותנה לפי `phase` (כמו §3). כפתורי `<button>` עם `aria-label={t(...)}`, אייקונים.
- ⏸/▶ נגזר מ‑`playlist.transport` (`paused`→▶, אחרת ⏸).
- **logical CSS** (skill rtl‑adaptation): `inline-start`/`inline-end`, `ms-/me-`, לא left/right.
- גדלים hands‑free (≥44px tap target; ר' frontend‑spec).

**Verification**: browser smoke — כל phase מציג את הכפתורים הנכונים.

### Commit 2 — חיווט פעולות + turnInterrupted (approach: manual, browser)

**קבצים שמשתנים**: `PlaybackControls.svelte`

- `onclick` → `voiceMode.cancelRun()` / `stopPlayback()` / `playlist.pause/resume/next/prev`.
- אם `session.turnInterrupted` → חיווי קצר (`t("playbackControls.interrupted")`), נעלם בתור הבא.
- החלף קריאות ישנות ל‑`voiceMode.cancel()` (ב‑`MicLarge.svelte` ×2: שורות 45/89 — **אין MicButton**, אביגיל #2) → `cancelRun()` (והסר את ה‑alias `@deprecated`).

**Verification**: אימות חי מלא (DoD).

## §5 — DoD

| בדיקה | איך |
|---|---|
| phase=thinking/responding/calling‑tool → כפתור עצור‑ריצה, טקסט נכון | browser, 3 מצבים |
| ⏹ עצור‑ריצה → סוכן+קול נעצרים | browser + turnState→idle |
| phase=speaking → ⏹/⏸▶/⏮/⏭ מופיעים | browser |
| ⏸→▶ משהה וממשיך קול | האזנה |
| ⏮/⏭ מנווט בין משפטים | האזנה |
| stopPlayback עוצר קול, הריצה ממשיכה | האזנה + הבועה |
| RTL: כפתורים מיושרים נכון בעברית ובאנגלית | browser בשתי שפות |
| נייד: tap targets גדולים מספיק | linux‑gui/טלפון |
| turnInterrupted מוצג כשהתור נקטע | סימולציה (detach) |
| i18n: אין מחרוזת קשיחה | `pnpm lint:i18n` ירוק |
| build‑gate | typecheck + tests ירוקים |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| מחרוזת עברית קשיחה → hook חוסם | README §6 #1 | כל טקסט `t(key)`; lint:i18n. |
| RTL: left/right פיזיים | skill rtl‑adaptation | logical classes בלבד; בדיקה בשתי שפות. |
| StatusBubble כבר `align-self:flex-end` | StatusBubble.svelte:49 | שמור; הוסף בקרה בתוך אותו container. |
| כפתורים קטנים מדי לנהיגה | frontend‑spec | ≥44px; אימות נייד. |
| reactivity: phase/transport derived | — | קריאה דרך getcontext getters (כבר reactive). |

## §7 — Escalation triggers

- מתברר שצריך control‑bar קבוע (לא בתוך StatusBubble) ל‑UX נהיגה → החלטת מיקום, שאל מרדכי
  (roadmap §4 השאיר פתוח — נטייה bar).
- פעולת תשתית חסרה/לא מתנהגת כצפוי (A1‑A5) → באג בתשתית, חזור ל‑slice הרלוונטי.
- car‑mode/Media Session נדרש → חורג ל‑Track C.

## §8 — Complexity score

6/10: UI component (+1), conditional rendering פר‑phase (+1), RTL (+1), i18n (+1), wiring (+1),
browser+mobile verification (+1). → **verifier: heavy** (visual + flows).

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | מיקום: בתוך StatusBubble או control‑bar קבוע מעל footer? | בתוך StatusBubble ל‑MVP; bar אם הצפיפות מציקה | ❌ |
| 2 | turnInterrupted — חיווי או שקט? | חיווי מינימלי קצר | ❌ |
| 3 | להסיר את alias `cancel()` עכשיו או להשאיר? | להסיר (B1 מחווט הכל) | ❌ |
