# Spike — subagent-transcript-fixture (Gate 1 לפני B1)

> **תאריך**: 2026-07-11
> **סוג**: spike חקירתי חי — **לא dispatch לאליעזר**. מריץ: harness/calev-spike; מכריע: מרדכי.
> **מזין**: `prebrief-subagent-nested-bubble.md` §9 (השאלות החוסמות) → B1 `subagent-transcript-data-v2`
> **base**: dev @ v0.17.0 (acp-stack merged — `_claude/sdkMessage` path חי)
> **תלות**: [`acp-stack-upgrade`] ✅ merged

---

## §1 — מטרה

לייצר **fixture ‏מצונזר וחתום-timestamp** ‏שלוכד את **‏שני הערוצים** ‏מ-Task ‏חי רב-שלבי,
‏ולענות על שאלות-§9 ‏החוסמות של ה-pre-brief — ‏כדי שאוכל להפוך את B1 ‏לבריף ביצועי
‏עם reducer-semantics ‏מבוססי-ראיה ‏(‏ולא ניחוש delta ‏מול snapshot).

**‏עקרון**: ‏אין לקבע append/grouping semantics ‏לפני שה-fixture ‏עונה על §9.

---

## §2 — שני ה-taps (אותרו בקוד)

| # | ‏צד | ‏מנגנון | ‏עוגן בקוד |
|---|-----|---------|-----------|
| **A** | ‏גולמי (‏מתאם↔claude) | `emitRawSDKMessages` + `forwardSubagentText:true` ‏ב-`_meta.claudeCode` → ‏המתאם פולט `_claude/sdkMessage` ‏כ-ext notification | ‏מבוקש ע"י FE ‏ב-`CLAUDE_SESSION_META` (`agent-session.svelte.ts`); ‏זורם דרך `connect-in-process.ts` `handleLine("in")`→`onFrame` |
| **B** | ‏ACP ‏מנורמל (‏מתאם→FE) | ‏frames ‏רגילים של `session/update` | ‏אותו wire, ‏אותו `onFrame` |
| **REC** | ‏הקלטה | `WIRE_RECORD=1` → `wire-recorder.ts` → `<state>/wire-recordings/<agentId>-<ts>.jsonl`, ‏שורת `{ts,dir,raw}` ‏פר-frame | ‏מחובר ב-`connection-registry.ts:123-133` דרך `conn.onFrame` |

**‏התובנה המכריעה**: ‏שני הערוצים (A+B) ‏רוכבים על **‏אותו wire** ‏בכיוון agent→FE (`dir="in"`).
‏לכן **‏הקלטת WIRE_RECORD ‏אחת, ‏כש-emitRawSDKMessages ‏פעיל, ‏לוכדת את שניהם משולבים לפי ts**.
‏זה בדיוק ה"‏שני הצדדים": `_claude/sdkMessage` = ‏מה ש-claude ‏שולח למתאם **‏לפני** ‏הסינון;
`session/update` = ‏מה שהמתאם פולט **‏אחרי** ‏הסינון. ‏ההשוואה ביניהם חושפת מה נזרק ואיך raw ‏ממופה ל-ACP.

---

## §3 — שתי דרכי-הרצה (שתיהן — "פרוקסי" + "הקלטה רגילה")

### (א) harness ‏headless — ‏ה-tap ‏הישיר (‏עיקרי, ‏דטרמיניסטי)

‏מרחיב את התבנית של `packages/provider/src/providers/claude/live/connect-in-process.live.test.ts`
‏(`RUN_LIVE=1`) ‏לסקריפט-spike. ‏מדמה את ה-FE ‏בכתיבת ACP JSON-RPC ‏ישירות ל-`wire.write()`:

1. `connectInProcess({ cwd })`
2. `initialize`
3. `session/new` ‏עם ‏ה-`_meta.claudeCode` ‏המלא:
   ```jsonc
   { "cwd": "<tmp>", "mcpServers": [],
     "_meta": { "claudeCode": {
       "options": { "forwardSubagentText": true },
       "emitRawSDKMessages": [
         {"type":"system","subtype":"task_started"},
         {"type":"system","subtype":"task_progress"},
         {"type":"system","subtype":"task_notification"},
         {"type":"system","subtype":"task_updated"},
         {"type":"assistant"}
       ] } } }
   ```
4. `session/prompt` ‏עם ‏תרחיש-ה-Task (§4)
5. `conn.onFrame((f) => allFrames.push({ ts: Date.now(), dir: f.dir, type: f.type, raw: f.raw }))`
   — ‏לוכד **‏את שני הערוצים** ‏(‏זה ה-tap ‏של ה-proxy).
6. ‏בסיום → ‏dump ל-fixture ‏JSON.

‏יתרון: ‏ללא דפדפן, ‏scriptable, ‏שולט בדיוק בתרחיש, ‏מייצר קובץ ישירות.

### (ב) ‏אפליקציה מלאה + WIRE_RECORD — ‏"‏ההקלטה הרגילה" (‏cross-check)

```bash
cd packages/backend
WIRE_RECORD=1 PORT=4000 bun src/server.ts     # onecli מיותר ל-spike זה (אין TTS)
# FE → התחבר claude → הרץ prompt של §4 בדפדפן (ה-FE כבר מזריק CLAUDE_SESSION_META)
tail -f data/wire-recordings/*.jsonl | jq
```

‏יתרון: ‏מוודא שה**‏נתיב-האמת של האפליקציה** ‏(‏FE→BE→adapter) ‏מייצר frames ‏זהים ל-harness.
‏שתי ההרצות יחד = ‏אימות-צולב שה-tap ‏וה-recording ‏רואים אותו דבר.

---

## §4 — התרחיש (§9 של ה-pre-brief)

**‏תרחיש עיקרי** — prompt ‏שכופה Task ‏יחיד:
1. ‏תת-סוכן כותב ≥2 ‏הודעות טקסט.
2. ‏תת-סוכן מפעיל ≥1 ‏כלי.
3. ‏המשימה מסתיימת בהצלחה.
4. ‏sentinel ‏ייחודי בטקסט (‏למשל `SPIKE_SUBAGENT_MARK`) ‏לזיהוי ב-fixture.

‏ניסוח-prompt ‏מוצע (‏לחדד בזמן ההרצה): *"‏השתמש בכלי Task ‏כדי לפתוח תת-סוכן שקורא שני קבצים
‏בתיקייה, ‏כותב שני משפטי-ביניים, ‏ומסכם. ‏הוסף בטקסט את הסימן `SPIKE_SUBAGENT_MARK`."*

**‏תרחיש-משנה** (‏אם אפשר): failure/cancel — ‏Task ‏שנכשל או `session/cancel` ‏באמצע.

---

## §5 — השאלות שה-fixture חייב לענות (§9) + jq

| # | ‏שאלה (§9) | ‏שאילתת-ניתוח |
|---|-----------|--------------|
| Q1 | raw assistant = delta ‏או snapshot ‏מצטבר? | ‏חלץ כל `_claude/sdkMessage` ‏מסוג assistant, ‏השווה `message.content[]` ‏בין frames ‏עוקבים עם אותו message-id — ‏האם content ‏חוזר/‏גדל? |
| Q2 | `tool_use`/`tool_result` ‏של תת-הסוכן — ‏בתוך assistant content, ‏כ-user event, ‏או אחר? | `jq 'select(...sdkMessage) | .message.content[].type'` |
| Q3 | ‏אילו `task_*` ‏נושאים `task_id` ‏מול `tool_use_id`? | ‏טבלת subtype→‏שדות קיימים |
| Q4 | `parent_tool_use_id` == ACP `toolCallId` ‏בדיוק? | ‏הצלב את ה-`parent_tool_use_id` ‏של assistant raw ‏מול ה-`toolCallId` ‏של ה-`tool_call` ‏ב-`session/update` |
| Q5 | ‏סדר-הגעה: ACP `tool_call` / `task_started` / assistant ‏ראשון? | ‏מיין הכל לפי `ts`, ‏הסתכל על הרצף |
| Q6 | message-ids ‏יציבים מספיק ל-grouping/dedup? | ‏בדוק אם ל-chunks ‏מאותה הודעה id ‏משותף יציב |
| Q7 | ‏מה מגיע ב-`session/load`? ‏ext ‏משוחזר או live-only? | ‏אחרי סיום — `session/load` ‏על אותו sessionId, ‏בדוק אם `_claude/sdkMessage` ‏חוזר |
| Q8 | ‏מה ב-failure/cancel/background? | ‏מתרחיש-המשנה |
| Q9 | ‏תת-סוכן מקונן (Task-בתוך-Task)? ‏שרשרת parent-ids? | ‏אם התרחיש מייצר — ‏מפה |

> **Q7 ‏הכי קריטי** — ‏קובע אם הפיצ'ר **‏live-only** (‏transcript ‏נעלם ב-reload) ‏או שצריך B3 ‏persistence.
> ‏זה הסעיף (ה) ‏שהמשתמשת העלתה ב-roadmap ‏המקורי.

---

## §6 — פורמט fixture + צנזור

- ‏שמור מערך משולב: `[{ ts, dir, channel: "acp"|"raw", type, frame }]` ‏(channel ‏נגזר: `_claude/sdkMessage`→raw, ‏אחרת→acp).
- **‏צנזור**: ‏החלף נתיבי-cwd, ‏tokens, ‏ותוכן-קבצים אמיתי ב-placeholders; ‏שמור **‏מבנה** (‏שדות, ids, ‏סדר, ‏types). ‏ה-sentinel ‏נשאר.
- ‏יעד: `packages/frontend/src/lib/view-models/__fixtures__/subagent-task-*.json` (‏ליד ה-VM ‏שיצרוך אותו ב-B1).
- ‏committed ‏ל-dev ‏(artifact ‏יקר — ‏אחרת נצטרך claude ‏חי בכל הרצת-טסט).

---

## §7 — DoD ה-spike

| # | ‏תוצר | ‏אימות |
|---|-------|--------|
| 1 | fixture ‏מצונזר משני הערוצים, ‏חתום-ts | ‏קובץ committed, ‏ללא secrets |
| 2 | 9 ‏השאלות (§5) ‏נענות בכתב | ‏סעיף-ממצאים ב-`decisions/drive-coding.md` |
| 3 | ‏אימות-צולב harness ↔ WIRE_RECORD | ‏אותם types/‏מבנה בשתי ההרצות |
| 4 | ‏הכרעת reducer-semantics (delta/snapshot) + replay (Q7) | ‏רשומה ל-decisions → ‏מזינה את B1 |

**‏לא ב-spike**: parser ‏production, normalization ‏מלא, subFrames ‏model, ‏UI. ‏זה B1/B2.

---

## §8 — אחרי ה-spike

1. ‏מרדכי כותב `slice-subagent-transcript-data.md` ‏כ-**B1-v2** ‏(‏או שם חדש) ‏עם semantics ‏מבוססי-fixture.
2. `state.json` ‏עם `depends_on:["acp-stack-upgrade"]` ‏(‏merged), `base: dev`, dev_tip ‏עדכני.
3. ‏אביגיל מאמתת B1 ‏מול הקוד + ‏ה-fixture ‏עד READY.
4. ‏הבריף הישן `slice-subagent-transcript-data.md` + `slice-claude-subagent-adapter-fork.md` → superseded/archive.
