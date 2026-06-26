# Design — Multi-client mux: שני לקוחות בו-זמנית מול CLI אחד

- **תאריך:** 2026-06-26
- **סטטוס:** 📐 **תיעוד-תוכנית. לא מאושר לביצוע, אין briefs.**
- **מקור:** session תכנון (מרדכי + משתמשת), 2026-06-26.
- **ייעוד:** מסמך זה נכתב כדי **להתמזג עם מאמץ-תכנון מקביל באותו אזור.** לכן ההחלטות
  והסוגיות-הפתוחות מסומנות מפורשות (ראה §"משטח ה-merge"). אל תתייחס אליו כ-spec נעול.

---

## 1. המטרה

לאפשר ל**שני לקוחות (או N) להתחבר בו-זמנית לאותו session של CLI**, כששניהם יכולים
**לכתוב** (prompts) — לא רק לצפות. ה-use-case המוביל: התחברות מהטלפון לסשן פעיל בזמן
שה-WS במחשב עדיין מחובר.

נבחר **מסלול "שני נהגים שווים"** (לא token / driver-יחיד) — שניהם מנפיקים בקשות
ל-agent.

---

## 2. ההחלטה המרכזית — להרכיב סביב האדפטר הקיים (supersede)

> **זה ה-supersede העיקרי.** התוכניות הקודמות
> (`provider-abstraction/docs/research/claude-code-acp/notes/multi-client-mechanism.md` §3)
> תיכננו **broker שמדבר stream-json גולמי** מול ה-CLI — כלומר לכתוב את ההתחברות
> ל-Claude Code מאפס.

**ההחלטה החדשה:** משאירים את כל ה-stack הקיים של ACP —
- האדפטר `@agentclientprotocol/claude-agent-acp` (npm `@latest`, ללא fork),
- ה-`AcpClient` של `provider-contract` ב-FE,
- ה-`bridge-manager` שמחזיק את ה-child —

ו**מכניסים mux ברמת ה-JSON-RPC** בנקודת-הצוואר שכבר קיימת (`writeStdin`). הרכבה סביב
הקיים, לא rewrite של פרוטוקול. זה מצמצם scope דרמטית: אין כתיבת-פרוטוקול, רק שכבת-תיווך.

---

## 3. עדכון מכריע — bypassPermissions מסיר את צד-התשובות

המשתמשת התחילה להשתמש ב-**מצב עקיפת-הרשאות** (`bypassPermissions`). האדפטר עושה
short-circuit כשה-session במצב זה ו**אינו פולט `request_permission` כלל**
(adapter line ~2480: `if (currentModeId === "bypassPermissions") return {behavior:"allow"}`).

**מסקנות:**
- אין בעיית **תשובה-כפולה** (אין בקשת-הרשאה לענות עליה פעמיים).
- אין **stall** (אין בקשת-הרשאה שנשארת ללא מענה כשאין FE).
- **Slice "auto-allow → BE" יורד מהתוכנית.** תפקיד ה-responder של ה-mux מתאדה.

> ⚠️ **סוגיה פתוחה (לאמת):** bypassPermissions מוחק `request_permission`, אבל **לא
> בהכרח** בקשות agent→client אחרות כמו `fs/read_text_file` / `fs/write_text_file`
> (אם האדפטר משתמש ב-fs בצד-לקוח). אם בקשות כאלה קיימות אצלנו — בעיית התשובה-הכפולה
> חוזרת עבורן, וצריך dedup. **לאמת מול הסכמה/wire-log אם fs/* נשלחות בכלל.** כרגע
> מניחים שלא, ולכן ה-mux נבנה בלי responder.

---

## 4. מגבלות שאומתו (ground truth, לא הנחות)

| # | ממצא | מקור |
|---|------|------|
| 1 | **fan-out יוצא כבר קיים** — `lineSubscribers: Set`, ה-reader משדר לכל subscriber | `packages/backend/src/acp/bridge-manager.ts` (Entry + `stdoutRl.on("line")`) |
| 2 | **חוסם יחיד** — guard MED-8: `activeFeWs: Map<agentId, WebSocket>`, לקוח שני → `close(1008)` | `packages/backend/src/delivery/ws-agent.ts` |
| 3 | **ה-FE הוא ה-ACP client** — מכונת-המצבים בדפדפן | `AcpClient` ב-`provider-contract` |
| 4 | **id-counter קשיח** — `nextRequestId++` מ-0, **אין seed/namespace** → אי-אפשר לחלק מרחבי-id ב-FE | `@agentclientprotocol/sdk@0.21.1` (`acp.js` `nextRequestId`) |
| 5 | **response יתום לא קורס** — `console.error("Got response to unknown request")` ואז נזרק | אותו SDK, `handleResponse` |
| 6 | **auto-allow = 12 שורות טהורות** (נדחה כרגע בגלל bypass) | `provider-contract` `adapters/acp/client/client-impl.ts:21–32` |
| 7 | **recorder write-only לדיסק** — אין `getFrames`/`replay`/buffer; JSONL ב-`/data/wire-recordings/` | `packages/backend/src/delivery/wire-recorder.ts` |

**המסקנה הקריטית מ-#4:** כל עוד **שני** הלקוחות מנפיקים בקשות (prompt, set_config_option),
ה-id-ים שלהם מתחילים שניהם מ-0 ומתנגשים. אי-אפשר לחלק מרחבים ב-FE (SDK מ-npm, ללא fork).
לכן **id-NAT ב-BE הוא הכרחי** — זו הליבה הקשה.

`ignore unmatched` (#5) מציל מ-**response יתום**, אבל **לא** מ-**התנגשות** (שני לקוחות
מחכים לאותו id למשמעויות שונות → אחד מקבל תשובה שגויה לבקשה שלו). זו בדיוק הסיבה
ל-id-NAT.

---

## 5. הארכיטקטורה — BE JSON-RPC mux

ה-`writeStdin` הוא כבר היום נקודת-צוואר יחידה שדרכה עובר כל client→agent, וה-BE כבר
מפענח כל שורה (`decodeWireLine`). שם נכנס ה-mux.

```text
                       ┌──────────────────────────► לקוח 1 (driver)
[CLI] ──JSON-RPC──────► [MUX @ BE] ──WS fan-out────► לקוח 2 (driver)
  (חיבור stdio יחיד)        │                        לקוח N
                            ├── id-NAT (per-client)
                            ├── fan-out נכנס
                            └── replay on attach
```

ה-mux הוא **ספרייה טהורה**: N זרמי-לקוח ↔ זרם-agent אחד, מקבל הודעות מפוענחות ומחזיר
החלטות-ניתוב. **unit-testable בלי WS/child** (מזינים אובייקטי-הודעה, בודקים routing).

**בית:** מתחילים **standalone** (גבול-API נקי קודם). בית סופי אולי `provider-contract`
ב-subpath **node-only** `./acp/mux` (לעולם לא מיובא ל-FE — אחרת מפוצץ את vite build, כמו
ה-barrel `./acp` שמושך `node:child_process`). standalone-first הוא בעיקר משיקול
גבול-API נקי; provider-abstraction הפעיל הוא כעת **Linux** (`~/projects/provider-abstraction`
= origin/main; עותק Windows D:\ stale), אז קיפול לתוכו אינו חסום-תהליכית. ההחלטה על
הבית מתקבלת אחרי שהגבול נכון.

---

## 6. תפקידי ה-mux (מעודכן — בלי responder)

| # | תפקיד | מה | חדש? |
|---|--------|-----|-------|
| 1 | **fan-out נכנס** | משדר client→agent גם ללקוחות האחרים (מודעות הדדית) | חדש, קל |
| 2 | **id-NAT** | טבלת-תרגום per-client; id יוצא נכתב מחדש ל-id עליון ייחודי (`upstreamId → {clientId, originalId}`); response מנותב **רק** ללקוח המקורי (לא broadcast) | חדש, **הליבה**, ACP-ספציפי |
| 3 | **replay on attach** | late-joiner מקבל backlog ל-port שלו בלבד; buffer חי בזמן catch-up + flush אחריו (בלי פער); סינון בקשות שכבר נסגרו | חדש, דורש read-side ל-recorder |

**~~responder + dedup~~** — נדחה. bypassPermissions מסיר את `request_permission`
(ראה §3). יחזור רק אם יתברר ש-`fs/*` agent→client קיימות.

**כללי ניתוב:**
- **notifications** (`session/update`, חסר-id) → broadcast לכל הלקוחות.
- **client→agent request** (prompt/config, יש id של הלקוח) → id-NAT, response חזרה
  ללקוח המקורי בלבד.
- **agent→client request** (יש id של ה-agent) → תחת bypass לא אמור לקרות; אם יקרה,
  זה הסעיף שיצטרך responder/dedup.

---

## 7. סמנטיקת turn-בודד (מאושר)

ה-agent מעבד **turn אחד בכל רגע**. במסלול "שני נהגים", שניכם יכולים להקליד, אבל אם
שניכם שולחים `session/prompt` באמצע turn — ה-agent מסדר אותם בטור (השני נתור/נדחה).
ה-mux רק מתווך; שניכם רואים את שני ה-prompts דרך ה-fan-out, ורואים את סדר ה-turns
של ה-agent. **זה לא חוסם — זו המציאות של שני נהגים על agent חד-turn.** המשתמשת אישרה.

---

## 8. פירוק ל-slices (טיוטה — לא briefs)

| slice | מה | depends_on | ערך עצמאי |
|--------|-----|------------|-----------|
| **B** | ספריית ה-mux — id-NAT + fan-out, טהורה, unit-tested, בלי חיווט | `[]` | lib בלבד |
| **C** | חיווט: mux לתוך bridge-manager/ws-agent; הרמת guard MED-8 ל-N לקוחות; הכל דרך ה-mux | `[B]` | כן — כאן 2 לקוחות באמת עובדים |
| **D** | read-side ל-recorder + replay-on-attach ל-late-joiner | `[C]` | כן — הטלפון רואה היסטוריה |
| **E** | FE: תצוגת prompt של הלקוח האחר; (UI-הרשאות לא נדרש תחת bypass) | `[C]` | כן — UX שני-נהגים |

> **שינוי מהטיוטה הקודמת:** Slice "A" (auto-allow → BE) **הוסר** בגלל bypassPermissions.
> השרשרת מתחילה מ-B.

JIT: לכשיגיע ביצוע, נכתוב brief ל-B קודם, השאר לומדים ממנו.

---

## 9. סוגיות פתוחות (לאמת לפני briefs)

1. **fs/* agent→client** — האם האדפטר שולח `fs/read_text_file`/`fs/write_text_file`
   בצד-לקוח גם תחת bypass? אם כן → responder/dedup חוזר לתוכנית. (ראה §3)
2. **id-NAT על notifications** — לאמת מול הסכמה ש-`session/update` תמיד חסר-id ולכן
   broadcast-only, לא דורש NAT.
3. **late-join state fidelity** — replay מסונן: לא לשחזר בקשות שכבר נסגרו כאילו תלויות.
4. **בית ה-mux** — standalone תחילה; מתי/אם לקפל ל-`provider-contract` (provider-abstraction
   פעיל על Linux כעת, לא חסום-תהליכית — שיקול גבול-API בלבד).

---

## 10. משטח ה-merge (לקריאה צמודה)

מסמך זה נועד להתמזג עם מאמץ-תכנון מקביל. נקודות-החפיפה הצפויות:

- **`provider-abstraction/docs/research/claude-code-acp/notes/multi-client-mechanism.md`**
  — מודל ה-broker (broadcast / serialize / responder-לפי-request_id). **מסמך זה
  supersede-ת את §3 שלו** (stream-json-from-scratch → הרכבה סביב אדפטר ACP).
- **`provider-abstraction/docs/research/claude-code-acp/findings/remote-control-bridge.md`**
  — ה-transport הרב-לקוחי הילידי של Claude Code (bridge + `sequence_num` + replay).
  prior-art; חסום מאחורי מנוי/feature-flag → בונים broker עצמאי.
- **`provider-abstraction/docs/design/ideas/backend-managed-http-transport.md`** —
  idea-doc (תיאורטי) שמונה multi-client כ-benefit. ה-mux כאן הוא צעד מוקדם/חלקי
  לכיוון ההוא, בלי לאמץ את כל ה-HTTP/SSE.
- **זיכרון (drive-coding):** `ws-disconnect-kills-backend` (שורש ה-stall + fix
  bypassPermissions), `ws-same-agent-two-tabs-thrashing` (MED-8 livelock — הסיבה
  שה-guard קיים, והמקום שבו הרמתו ב-Slice C מתחברת).

**ההחלטות הנעולות בדיון הזה (לשמר ב-merge):**
1. הרכבה סביב האדפטר הקיים — לא broker-from-scratch.
2. מסלול "שני נהגים שווים" עם סמנטיקת turn-בודד.
3. id-NAT ב-BE הכרחי (SDK חוסם partitioning ב-FE).
4. אין responder ב-BE כרגע (bypassPermissions) — בכפוף לסוגיה הפתוחה על fs/*.
5. ה-mux כספרייה טהורה standalone; בית סופי נדחה.
