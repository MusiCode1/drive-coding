/**
 * playback-registry.ts — רישום מנוע-ההשמעה לצורך תצפית בלבד.
 *
 * ─── slice playback-observability ───
 *
 * 🔴 **למה זה קיים.** באג ה"הקראה נפסקת פתאום" (‏21/08) ארך שעה, ורוב הזמן
 * הלך על כך שלא הייתה שום דרך להגיע ל-`AudioPlaylist` מהקונסול — הוא סגור
 * ב-Svelte context. נאלצתי לתפוס את `AudioBufferSourceNode.prototype.start`
 * מבחוץ כדי לספור השמעות. השורש, כשהתגלה, היה **‏`#cursor` שנדחף מעבר
 * לפריט שזה עתה נוסף** — נתון שהיה מופיע כאן כ-`cursor: 2 / items: 2`
 * ומאבחן את הבאג בשלושים שניות.
 *
 * ⚠️ **תצפית בלבד, ותמונות-מצב שטוחות.** לעולם לא רפרנס חי: ידית חיה
 * מאפשרת לשינוי מהקונסול (או מסוכן) לייצר heisenbug, ואז מדבגים את המדידה.
 * הרישום עצמו אינו מגודר — עלותו זניחה — אבל **החשיפה ל-window מגודרת**
 * ב-`dc.ts`, וב-ייצור גם בדגל-ריצה.
 */

/** תמונת-מצב של הפלייליסט. אף פעם לא רפרנס חי. */
export type PlaylistDebugInfo = {
  /** ⭐ הזוג שמאבחן: cursor ששווה ל-items פירושו "חונה בסוף". */
  cursor: number
  items: number
  /** האם לולאת-ההשמעה חיה (‏re-entrancy guard). */
  looping: boolean
  transport: string
  state: string
  currentSegmentId: string | null
  /** פילוח לפי state — `reserved` שנתקע הוא ממצא. */
  byState: Record<string, number>
}

/** תמונת-מצב של ה-sink. */
export type SinkDebugInfo = {
  /** כמה סגמנטים הוכנו (הבייטים הגיעו). */
  prepared: number
  /** ⭐ כמה **נוגנו** בפועל. הפער מול `prepared` הוא הבאג. */
  played: number
  currentSegmentId: string | null
}

/** תמונת-מצב של ה-Speaker — צד ה-**אחזור**, לפני שהאודיו קיים. */
export type SpeakerDebugInfo = {
  /** ⭐ כמה סגמנטים ממתינים **לתשובת TTS ברגע זה** (fetch באוויר). */
  inFlight: number
  /** כמה עוד בתור-האחזור וטרם יצאו. */
  queued: number
  /** תקרת המקביליות — `inFlight` לא יעלה עליה. */
  lookahead: number
  /**
   * ⭐ **הטקסטים שנשלחו ל-TTS בפועל**, אחרונים תחילה.
   *
   * בלעדיו כל שאלה מהצורה "למה X לא נשמע" נענית בניחוש: אי-אפשר לדעת אם
   * ‏X מעולם לא נכנס לתור, נכנס ודולג, או נכנס ונוגן ולא נשמע. שלוש
   * בעיות שונות לגמרי עם אותו תסמין.
   */
  recent: string[]
}

export type PlaybackDebugInfo = {
  /** ‏**תמיד 1** — `+layout` מזריק מופע יחיד ל-Speaker ול-BubblePlayer.
   *  מוצג במפורש דווקא מפני שזו קביעה שיכולה להישבר בשקט במיזוג. */
  playlists: number
  playlist: PlaylistDebugInfo | null
  sink: SinkDebugInfo | null
  speaker: SpeakerDebugInfo | null
}

export type DebuggablePlaylist = { debugInfo(): PlaylistDebugInfo }
export type DebuggableSink = { debugInfo(): SinkDebugInfo }
export type DebuggableSpeaker = { debugInfo(): SpeakerDebugInfo }

const playlists = new Set<DebuggablePlaylist>()
let sink: DebuggableSink | null = null
let speaker: DebuggableSpeaker | null = null

export function registerPlaylist(p: DebuggablePlaylist): void {
  playlists.add(p)
}
export function unregisterPlaylist(p: DebuggablePlaylist): void {
  playlists.delete(p)
}
export function registerSink(s: DebuggableSink): void {
  sink = s
}
export function registerSpeaker(s: DebuggableSpeaker): void {
  speaker = s
}

export function playbackDebugInfo(): PlaybackDebugInfo {
  const first = [...playlists][0]
  return {
    playlists: playlists.size,
    playlist: first ? first.debugInfo() : null,
    sink: sink ? sink.debugInfo() : null,
    speaker: speaker ? speaker.debugInfo() : null,
  }
}
