# Slice A3 — transport (pause/resume/stop) + הפרדת cancel — תוכנית

> **תאריך**: 2026-06-28
> **סטטוס**: מאושר (אביגיל דולגה לבקשת המשתמשת)
> **Complexity**: 7/10 (verifier: heavy — נוגע ב‑WebAudio/MediaSource חי)
> **תלות**: [A2] · **base**: branch `slice/playback-core-a2`
> **שייך ל**: `docs/plans/playback-run-control-roadmap.md` (slice 3/6)

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/playback-core-a3 -b slice/playback-core-a3 slice/playback-core-a2
cd .worktrees/playback-core-a3
pnpm install && pnpm hooks:install
```

### Run / Browser
- BE עם `onecli run --agent voice-acp`; FE; **אימות pause/resume דורש קול חי** ב‑browser
  (suspend/resume של AudioContext + audio.pause לא נבדקים ב‑JSDOM).

### Reading list
**must-read**:
- `packages/frontend/src/lib/engines/audio-sink.ts` — interface (מרחיבים).
- `packages/frontend/src/lib/engines/pcm-audio-stream.ts` — `#ctx`, `play()`, `#nextStartTime`, `cancel()`.
- `packages/frontend/src/lib/engines/audio-stream.ts` — `#current`, `play()`, `cancel()`.
- `packages/frontend/src/lib/engines/audio-playlist.svelte.ts` — מ‑A2.
- `packages/frontend/src/lib/view-models/derived/voice-mode.svelte.ts` — `cancel()` המאוחד.
- `packages/frontend/src/lib/view-models/speaker.svelte.ts` — `stop()`/`#stopAndClear`.
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — `cancelTurn()` (1031‑1042).

## §1 — מטרה

אחרי הסבב: אפשר **להשהות** השמעה ולהמשיך מאותה נקודה, **לעצור** השמעה לגמרי, וכל זה
**בלי לגעת בריצת הסוכן**. ובמקביל — `cancel()` המאוחד מתפצל לשתי פעולות מובהקות:
`stopPlayback()` (השמעה בלבד) ו‑`cancelRun()` (עוצר את הסוכן **וגם** את ההשמעה). זה
מכין את כל הפעולות שה‑UI ב‑B1 יחווט אליהן.

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| `pause`/`resume` ב‑שני ה‑AudioSinks | ✅ | — |
| `pause`/`resume`/`stop` ב‑AudioPlaylist | ✅ | — |
| `stopPlayback()` / `cancelRun()` (פיצול cancel) | ✅ | — |
| `cancelRun` עוצר גם השמעה | ✅ | — |
| next/prev/jumpTo | ❌ | A4 |
| UI לכפתורים | ❌ | B1 |
| watchdog | ❌ | A5 |

## §3 — Architecture diagram

```
engines/audio-sink.ts (interface)
  + pause(): void        ← חדש
  + resume(): void       ← חדש

pcm-audio-stream.ts   → pause: ctx.suspend() ; resume: ctx.resume()
audio-stream.ts       → pause: #current?.audio.pause() ; resume: #current?.audio.play()
routing-audio-sink.ts → מאציל לשני ה-sinks (שניהם, או רק הפעיל)

audio-playlist.svelte.ts
  transport: "playing" | "paused" | "stopped"  (מרחיב את state מ-A2)
  + pause() / resume()   ← מאציל ל-AudioSink + מקפיא את #playLoop
  stop()                  ← קיים, מוודא transport=stopped

view-models/derived/voice-mode.svelte.ts
  cancel()  ── מתפצל ל:
  + stopPlayback()  → speaker.stop()   (השמעה בלבד; לא נוגע בריצה/mic)
  + cancelRun()     → mic.cancel() + speaker.stop() + session.cancelTurn()
```

## §4 — Commits

### Commit 0 — pause/resume ב‑AudioSink interface + שני ה‑streams (approach: manual)

**קבצים שמשתנים**: `audio-sink.ts`, `pcm-audio-stream.ts`, `audio-stream.ts`, `routing-audio-sink.ts`

**API skeleton**:
```ts
interface AudioSink {
  prepareSegment(...): Promise<void>   // קיים
  play(id: string): Promise<void>      // קיים
  cancel(id: string): void             // קיים
  clear(): void                        // קיים
  pause(): void                        // חדש — משהה את הניגון הנוכחי
  resume(): void                       // חדש — ממשיך
}
```
- **PcmAudioStream**: `pause` → `if (#ctx?.state==="running") void #ctx.suspend()`;
  `resume` → `if (#ctx?.state==="suspended") void #ctx.resume()`. (ה‑`#nextStartTime`
  cursor "קופא" אוטומטית כי ה‑AudioContext clock עוצר — ⚠️ לאמת חי שאין gap/דריפט.)
- **AudioStream**: `pause` → `#current?.audio.pause()`; `resume` → `void #current?.audio.play()`.
- **RoutingAudioSink**: `pause`/`resume` → קרא לשני ה‑sinks (תמים — מי שלא פעיל no‑op).

**Verification**: typecheck. (התנהגות → DoD חי.)

### Commit 1 — transport ב‑AudioPlaylist (approach: manual)

**קבצים שמשתנים**: `audio-playlist.svelte.ts`

```ts
class AudioPlaylist {
  transport: "playing" | "paused" | "stopped" = $state("stopped")
  pause(): void    // transport=paused ; audioStream.pause() ; #playLoop רואה paused וממתין
  resume(): void   // transport=playing ; audioStream.resume() ; משחרר את #playLoop
  stop(): void     // קיים — transport=stopped ; מנקה (A2)
}
```
- `#playLoop`: לפני/בין `play(id)` בודק `transport`. אם `paused` → ממתין (poll/signal) עד
  `playing`/`stopped`. אם `stopped` → יוצא.
- `pause` באמצע `await play(id)` → ה‑AudioSink.pause עוצר את האודיו; ה‑Promise של play
  **לא** resolves עד resume → ה‑loop לא מתקדם. ⚠️ לאמת: pause לא גורם ל‑`ended`/`error` שמדלג.

**Verification**: typecheck + אימות חי.

### Commit 2 — פיצול cancel ל‑stopPlayback/cancelRun (approach: manual)

**קבצים שמשתנים**: `voice-mode.svelte.ts`

```ts
class VoiceMode {
  isCancelling: boolean      // קיים
  /** עצירת השמעה בלבד — לא נוגע בריצת הסוכן ולא ב-mic. */
  stopPlayback(): void       // this.#speaker.stop()
  /** עצירת הסוכן + ההשמעה (החלטה #3). */
  cancelRun(): void          // isCancelling=true ; mic.cancel() ; speaker.stop() ; session.cancelTurn()
  /** @deprecated — נשאר זמנית כ-alias ל-cancelRun עד B1 מחווט. */
  cancel(): void             // = cancelRun()
}
```
- ה‑`cancel()` הקיים נשאר כ‑alias (לא לשבור קוראים קיימים — MicButton). B1 יחליף קריאות.
- `isCancelling` reset ($effect) נשאר כפי שהוא.

**Verification**: typecheck + `pnpm --filter frontend test` (אם יש טסט ל‑VoiceMode).

## §5 — DoD

| בדיקה | איך |
|---|---|
| pause עוצר אודיו, resume ממשיך מאותה נקודה (PCM/Gemini) | האזנה חיה |
| pause/resume ב‑ElevenLabs (MP3) | האזנה חיה |
| stopPlayback עוצר קול אבל הריצה ממשיכה | האזנה + הבועה ממשיכה thinking |
| cancelRun עוצר גם קול וגם ריצה | turnState→idle + קול נעצר |
| אין gap/דריפט אחרי resume (PCM cursor) | האזנה — תשומת‑לב מיוחדת |
| build‑gate | typecheck + tests ירוקים |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| AudioContext.suspend משאיר `#nextStartTime` לא‑מסונכרן | pcm‑audio‑stream.ts §play | האזנה חיה ל‑gap; אם דריפט → להוון את ה‑cursor ב‑resume (`#nextStartTime = ctx.currentTime`). escalate אם מורכב. |
| `audio.pause()` ואז `play()` קופץ/מאפס | MediaSource quirk | לאמת חי; MediaSource שומר currentTime — אמור להמשיך. |
| pause באמצע `await play` → loop מדלג | streaming | ודא ש‑pause לא פולט `ended`/reject; ה‑promise תלוי. integration אם אפשר. |
| שבירת MicButton (cancel alias) | learnings — refactor | השאר `cancel()` כ‑alias עד B1. |
| WebAudio לא ב‑JSDOM | README §1 | אימות חי בלבד ל‑Commit 0/1. |

## §7 — Escalation triggers

- resume גורם gap/דריפט שדורש שכתוב ה‑gap‑less scheduling ב‑PcmAudioStream → שאל מרדכי
  (אולי slice נפרד).
- pause/resume ב‑MediaSource מאבד buffer / זורק → שאל.
- מסתבר ש‑`cancelTurn` לבד לא מספיק לעצירת ריצה אמינה → קשור ל‑A5/roadmap Track F.

## §8 — Complexity score

7/10: WebAudio/MediaSource state (+2), interface change (+1), VM refactor (+2), 3 commits (+1),
browser‑only verification (+1). → **verifier: heavy**.

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | resume ב‑PCM — לאפס `#nextStartTime`? | לא, אלא אם נשמע דריפט (אז כן) | ❌ |
| 2 | RoutingAudioSink.pause — שני ה‑sinks או רק הפעיל? | שניהם (no‑op על לא‑פעיל) | ❌ |
| 3 | `stopPlayback` — גם מנקה jobs ממתינים או רק עוצר ניגון? | מנקה (כמו `speaker.stop()` הקיים) | ❌ |
