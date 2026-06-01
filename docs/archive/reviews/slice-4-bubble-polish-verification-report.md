# Slice 4 — Bubble Polish — Verification Report

> **תאריך:** 2026-05-29  
> **Commit בסיס:** `f5b06c1`  
> **Slice tip:** `f8c521f`  
> **שיטה:** browser חי דרך `playwright-cli` headless Chrome מול FE/BE אמיתיים, BE דרך OneCLI על port 4001, FE Vite על 5173.  
> **Screenshots:** `/tmp/verify/slice-4-bubble-polish/*.png`  
> **Verdict:** ❌ **NEEDS REVISION** → ✅ **תוקן 2026-05-29** (ראה "עדכון תיקון" בתחתית) → ✅ **תוקן 2026-05-29 17:11** (ראה "עדכון תיקון" בתחתית)

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 8/15 עוברים, 2 חלקיים/לא אומתו, 5 נכשלים |
| Regressions | 1 חשוד: Speaker cancel נשאר תקוע על `Cancelling…` |
| Bugs חדשים | 4 משמעותיים |
| Tests ש-executor הכריז | לא הורצו מחדש כראיית verification; נבדקה התנהגות חיה. ה-prompt טען ל-typecheck/test/lint/build ירוקים. |

## סביבה שהופעלה

- BE קיים שהרמתי בתחילת הסשן: `proc_2026-05-29T1643_be54a5`, מאזין על `4001` דרך `onecli run --agent voice-acp`.
- FE קיים שהרמתי בתחילת הסשן: `proc_2026-05-29T1643_5131da`, Vite על `http://localhost:5173/`.
- Browser: `npx --no-install playwright-cli open http://localhost:5173`, Chrome headless.
- linux-gui לא היה זמין (`ssh linux-gui` → `No route to host`), לכן השתמשתי ב-Chrome מקומי דרך Playwright CLI.

## טבלת DoD items

| # | Item מה-brief | סטטוס | עדות |
|---|---------------|--------|------|
| 1 | `pnpm typecheck` ירוק | ⓘ | לא הורץ מחדש; לא ראיית verifier לפי ההנחיה. |
| 2 | `pnpm test` ירוק + markdown tests | ⓘ | לא הורץ מחדש; walkthrough טוען 11 tests חדשים. |
| 3 | `pnpm lint:i18n` ירוק | ⓘ | לא הורץ מחדש. |
| 4 | FE build ירוק | ⓘ | לא הורץ מחדש. |
| 5 | smoke `chat-roundtrip.mjs` עובר | ⓘ | לא הורץ מחדש; התמקדתי ב-browser flows. |
| 6 | `tool_call` יוצר ToolBubble | ✅ | Prompt: `read the README briefly`; snapshot `after-tool-prompt.yml` שורות 443-447 + 487-492 מציגות ToolBubbles במצב Completed. |
| 7 | `ToolBubble.narration` מתעדכן אחרי completed | ✅ | snapshot `after-tool-prompt.yml` שורות 443-445: narration עברית הופיעה; כלי שני קיבל narration אחרי המתנה (`tool-expanded-1.yml` שורות 498-503). |
| 8 | click על ToolBubble → expand מציג args + result | ✅ | `tool-expanded-1.yml` שורות 443-453: Input `{}` ו-Output JSON מוצגים אחרי click. |
| 9 | ThoughtBubble מציג HE + EN | ❌ | חלק מה-sentences כן HE+EN, אבל מיד אחריהם מופיעים אותם thoughts מפורקים ל-token/word raw באנגלית. `after-tool-prompt.yml` שורות 417-442; `tool-expanded-1.yml` שורות 456-497. |
| 10 | MessageBubble מרנדר markdown | ❌ | נכשל בפועל: markdown streaming מפורק לפסקאות/טוקנים. `after-markdown-wait.yml` שורות 377-409: heading ריק, `**`, backticks ו-code fence מוצגים כפסקאות נפרדות במקום bold/inline/code block תקין. |
| 11 | XSS attempt נחסם | ✅ | Prompt עם `<img src=x onerror=alert(1)>`; `globalThis.__voiceAcpDialogs` נשאר `[]`; snapshot `after-xss.yml` שורות 627-639 מציג טקסט מפורק, לא `<img>` פעיל. |
| 12 | RTL: user ימין, agent שמאל | ✅ | Visual screenshots: `/tmp/verify/slice-4-bubble-polish/chat-connected-*.png`, `/tmp/verify/slice-4-bubble-polish/chat-after-tool-*.png`. |
| 13 | loadSession: היסטוריה חוזרת, אין TTS playback אוטומטי | ⚠️ | היסטוריה חוזרת. לא נצפו ElevenLabs TTS חדשים אחרי load, אבל כן נוצר storm של narrate/Google calls בזמן replay/אחריו — לא “quiet/cache-only” לפי §1. |
| 14 | BE proxy cache hit על narrate חוזר | ❌ | בזמן loadSession היו עשרות `proxy → upstream` ל-Google + `168 warnings` של `narrate timeout 3000ms`. יש cache hit בודד, אבל רוב הקריאות לא היו cache hits. |
| 15 | Walkthrough עודכן + slices.md ✅ | ✅ | `docs/walkthrough.md` עודכן בראש; `docs/plans/slice-4-bubble-polish.md` סטטוס הושלם. |

## Flows שעבדו מקצה לקצה

- ✅ Connect ל-opencode דרך BE אמיתי + WS — connect עבר ל-`/chat`, status `connected`.
- ✅ Tool flow בסיסי — `read the README briefly` יצר ToolBubble, narration עברית, expand/collapse עם Input/Output.
- ✅ XSS sanitizer — לא נפתח alert, לא נוצר `<img>` פעיל.
- ✅ Session picker/loadSession בסיסי — אחרי reload אפשר לטעון session קיים וההיסטוריה מוצגת.

## Flows שנשברו

### ❌ Bug 1 — Markdown rendering נשבר על streaming segments

**צעדים:** שלחתי prompt:  
`Show a tiny Python hello world example in markdown with a heading, a bullet list, **bold**, inline code, and a fenced code block.`

**צפוי:** heading, list, bold, inline code ו-code block מרונדרים כיחידה אחת.

**קיבלתי:** markdown נשבר לפסקאות נפרדות: heading ריק, `**` כפסקה, backticks כפסקאות, `python` ו-`print(...)` כפסקאות במקום code block.

**Evidence:** `after-markdown-wait.yml` שורות 377-409.

**גורם מוערך:** `MessageBubble.svelte` מריץ `renderMarkdown(seg.text)` לכל segment בנפרד (`packages/frontend/src/lib/components/chat/bubbles/MessageBubble.svelte:25-27`) במקום `renderMarkdown(bubble.segments.map(...).join(""))`. זה בדיוק edge case שהbrief הזהיר עליו ב-§Commit 7 “Streaming markdown”.

**חומרה:** High/P0 ל-slice — DoD #10 נכשל, המטרה המרכזית “הודעות assistant מרונדרות עם markdown מלא” לא מתקיימת.

### ❌ Bug 2 — ThoughtBubble מציג תרגום חלקי + raw token leftovers

**צעדים:** prompt רגיל + tool prompt.

**צפוי:** ThoughtBubble עם HE prominent + EN קטן, ללא כפילות raw token-by-token.

**קיבלתי:** בתחילת ה-thought מופיעים 2-3 segments מתורגמים HE+EN, ואז אותו תוכן ממשיך כ-token/word raw באנגלית: `wants`, `me`, `to`, `read`, ...

**Evidence:** `after-tool-prompt.yml` שורות 417-442; `tool-expanded-1.yml` שורות 456-497.

**גורם מוערך:** ה-writeback ממפה sentence-level TTS jobs ל-segment יחיד לפי counter (`speaker.svelte.ts:369-394`), בזמן שה-ACP segments הם chunks/tokens (`agent-session.svelte.ts:370-419`). תוצאה: רק segment ראשון מוחלף במשפט מתורגם מלא, והמשך ה-segments נשארים raw.

**חומרה:** High — DoD #9 נכשל וה-UI הופך פחות קריא מהמצב הקודם.

### ❌ Bug 3 — loadSession מפעיל narrate storm על היסטוריה

**צעדים:** reload → Load recent sessions → בחירת session קיים → Connect.

**צפוי:** היסטוריה חוזרת, בלי autoplay ועם cache hits על translations/narrations קיימים; אין תשלום/קריאות מיותרות.

**קיבלתי:** מיד אחרי loadSession נרשמו עשרות קריאות `proxy → upstream` ל-Google generateContent סביב `16:53:36`, ואז `168 warnings` ב-console של `narrate failed {err: narrate timeout 3000ms}`.

**Evidence:**
- `after-reconnect.yml` נטען ומציג היסטוריה.
- BE log tail: רצף גדול של `provider="google" path="/v1beta/models/gemini-flash-lite-latest:generateContent" msg="proxy → upstream"` סביב `16:53:36`.
- console log `.playwright-cli/console-2026-05-29T16-48-26-615Z.log` שורות 4-141: `narrate timeout 3000ms` חוזר.

**גורם מוערך:** `#processToolBubbles` מדלג בזמן `isLoadingHistory === true`, אבל ברגע שה-flag יורד ל-false, ה-effect רץ שוב ומעבד את כל ToolBubbles ההיסטוריים שחסרים narration (`speaker.svelte.ts:315-354`). אין marking של tool bubbles historical-as-processed ואין persistence של narration בהיסטוריה.

**חומרה:** High — מפר את §1 (“loadSession ... cache hits ... ללא תשלום נוסף”) ואת DoD #14. בנוסף יוצר timeout storm ב-UI.

### ⚠️ Bug 4 / Regression suspect — Speaker cancel נתקע על `Cancelling…`

**צעדים:** אחרי response ארוך עם TTS פעיל לחצתי על כפתור `Speaking…`.

**צפוי:** playback נעצר, הכפתור חוזר ל-idle/mic.

**קיבלתי:** UI נשאר `Cancelling…` disabled גם אחרי המתנה וגם אחרי שליחת prompts נוספים, עד reload.

**Evidence:** `after-speaker-stop.yml` שורות 413-416; `after-cancel-wait.yml` שורות 412-416; `tool-prompt-ready.yml` שורות 413-416.

**גורם מוערך:** `VoiceMode.cancel()` מגדיר `isCancelling = true` ומחכה ש-`speaker.state === "idle"` (`derived/voice-mode.svelte.ts:54-63`, `72-77`). בפועל ה-state לא חוזר ל-idle אחרי `Speaker.stop()`/`#stopAndClear()` (`speaker.svelte.ts:397-421`) או שיש fetch/Player state שלא מתאפס.

**חומרה:** Medium/High — regression visible ל-Speaker/VoiceMode flow.

## Regressions

- ❌ Speaker/VoiceMode cancel flow: כפתור נתקע על `Cancelling…` לאחר stop. זה flow קיים מ-slice 3/2 ולכן חשוד כרגרסיה או לפחות bug קיים שנחשף ע״י slice 4.

## Bugs חדשים שלא ברשימה

- ❌ Markdown-per-segment — נובע ישירות מהמימוש החדש של slice 4.
- ❌ Thought translation duplicate/raw leftovers — נובע מ-writeback החדש של slice 4.
- ❌ loadSession narrate storm — נובע מהאינטגרציה החדשה של ToolBubble narration עם `Speaker`.
- ⚠️ Speaker cancel stuck — ייתכן regression עקיף בגלל עומס TTS/translation של slice 4.

## סיווג ל-patterns.md

לא הצלחתי לטעון את `~/.agents/skills/planner-executor-research/patterns.md` — הקובץ/skill לא קיים בסביבה (`No files found`). סיווגתי מול הקטגוריות הידועות מה-prompt:

| באג | קטגוריה | הערה |
|---|---|---|
| Markdown-per-segment | Category 1 — Bubble grouping | Streaming chunks/segments מוצגים כיחידות render עצמאיות במקום bubble אחד מצטבר. |
| Thought raw leftovers | Category 1 — Bubble grouping | אותה בעיית chunk grouping, הפעם ב-ThoughtBubble/translation writeback. |
| loadSession narrate storm | Category 3 — Spec drift / replay behavior | ה-brief דרש replay שקט/cache-only; המימוש מריץ narrate אחרי replay. |
| Speaker cancel stuck | unique / async state | נראה race או state שלא מתאפס בין VoiceMode/Speaker/Player. |

## סיכום לסוכן הבא (executor של ה-fix)

עדיפות תיקון:

1. **Markdown rendering:** ב-`MessageBubble.svelte`, לרנדר את כל `bubble.segments.map(s => s.text).join("")` פעם אחת, לא per segment. לשמור hidden segment count אם צריך reactivity.
2. **Thought translation:** אל תחליף segment יחיד במשפט מתורגם מלא אם שאר ה-chunks נשארים גלויים. או לאחד display ל-bubble-level translated/original, או לשמור mapping אמיתי של segment ranges, או להציג רק translated sentences ולא raw leftovers.
3. **loadSession replay:** בזמן history replay צריך לסמן ToolBubbles כ-processed לנרטיב, או לשמור narration בהיסטוריה, או לדחות narrate רק לכלים live אחרי replay. כרגע `#processToolBubbles` רץ על כל ההיסטוריה אחרי `isLoadingHistory=false`.
4. **Speaker cancel:** לבדוק למה `VoiceMode.isCancelling` לא מתאפס אחרי `Speaker.stop()`. ודא `speaker.state` חוזר ל-idle ושה-Player/AudioStream abort מנקה state גם כש-fetch נכשל.

**Verdict:** ❌ NEEDS REVISION — אין merge ל-dev עד תיקון Bug 1-3 לפחות.

## עדכון תיקון — 2026-05-29

כל 4 הממצאים תוקנו בעץ העבודה:

| # | באג | תיקון | קובץ |
|---|------|--------|------|
| 1 | Markdown per-segment | `renderMarkdown(joinSegmentText(bubble.segments))` על כל הבועה | `bubbles/MessageBubble.svelte:26`, `bubbles/bubble-rendering.ts` |
| 2 | Thought raw leftovers | `visibleThoughtSegments` מציג רק translated אם קיים תרגום | `bubbles/ThoughtBubble.svelte:18,23`, `bubbles/bubble-rendering.ts` |
| 3 | loadSession narrate storm | `#processedNarrationCallIds` מסמן כל tool call בזמן replay כ-processed | `view-models/speaker.svelte.ts:315-365` |
| 4 | Speaker cancel stuck | `Player.stop()` מאפס `state="idle"` מיידית | `engines/player.svelte.ts:55-61` |

בדיקות: typecheck (0 שגיאות), test (369 passed / 11 skipped, +2 טסטים ל-bubble-rendering), lint:i18n, build — כולם ירוקים. בדיקת replay חיה (reload → Load recent sessions → connect) לא הראתה רצף `proxy → upstream` ל-Google אחרי ה-replay.
