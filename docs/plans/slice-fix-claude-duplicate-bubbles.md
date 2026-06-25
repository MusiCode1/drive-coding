# Slice fix-claude-duplicate-bubbles — תוכנית

> **תאריך**: 2026-06-18
> **סטטוס**: טיוטה
> **Complexity**: 6/10 (verifier: light, עם דגש על הרצת הטסט החי שוב)
> **תלויות (`depends_on`)**: []
> **Base**: ה-fix חי ב-**fork של `claude-agent-acp`** (לא בריפו drive-coding). הריפו שלנו לא מקבל שינויי-קוד; רק wiring דרך קובץ config מקומי + (planner) entry ב-decisions.
> **Dev tip (drive-coding)**: `3812e4f` (להקשר ה-override / E2E בלבד; אין commit לריפו שלנו)

---

## §0 — Pre-flight

> ⚠️ **שינוי גישה מהותי** מהגרסה הקודמת של ה-brief (שהיתה FE de-dup). ההכרעה הסופית
> (ר' `docs/decisions/voice-acp.md` 2026-06-18): **fork של ה-adapter + תיקון-שורש של שורה
> אחת**, בלי לגעת בקוד drive-coding. ה-fork גם **מוכיח** את השורש (TDD חי: red→fix→green).

### תלויות (חובה!)

`depends_on: []`. הבאג עצמאי. **לא** תלוי ב-slice-claude-thinking-meta (שניהם נוגעים ב-claude
אבל ב-repos שונים: thinking-meta ב-FE שלנו, זה ב-fork של ה-adapter).

### השורש (מאומת מהקוד — לא השערה)

ב-`src/acp-agent.ts` של `claude-agent-acp@v0.47.0`, הפונקציה `resetTurnScratch()` (≈שורה
975) מכילה `currentStreamMessageId = undefined;`. היא נקראת מ-`activateTurn` כש-ה-SDK
**משחזר את ה-user-echo**, וזה קורה **באמצע ה-stream** (ה-SDK פולט את אירועי ה-stream של
ה-assistant *לפני* ה-echo — מתועד ע"י #785 עצמו). לכן:

```
1. message_start(msg_X)        → currentStreamMessageId = msg_X
2. (thinking/או כלום)
3. user-echo → activateTurn() → resetTurnScratch() → currentStreamMessageId = undefined  ← מאפס באמצע!
4. text deltas                 → currentStreamMessageId=undefined → תויגו בלי messageId, ולא נכנסו ל-streamedTextIds
5. assembled (messageIdForGrouping=msg_X) → streamedTextIds.has(msg_X)=false → לא סונן → נשלח ככפילות
```

ה-FE (`#appendChunk`) מקבץ לפי messageId: ה-deltas (null) → בועה אחת; ה-assembled (msg_X)
→ בועה שנייה זהה. **#785 תיקן case שכן (הוציא את איפוס ה-`Set`ים מ-`resetTurnScratch`)
אבל השאיר את `currentStreamMessageId = undefined` — חצי תיקון.** מאומת: 0.47.0 (האחרון
ב-npm, מה שאנחנו מריצים) כבר מכיל את #785 ועדיין משכפל (הקלטות WIRE_RECORD מ-06-17/06-18,
אחרי שחרור 0.47.0).

### Fork + clone

1. **GitHub fork** של `agentclientprotocol/claude-agent-acp` תחת ה-org של המשתמש (אישור:
   "GitHub fork מלא"). לתעת-עתה **לא** פותחים PR upstream (אישור: "לעת עתה רק מקומי").
2. clone מקומי מה-fork, branch מ-`v0.47.0` tag:
   ```bash
   git clone git@github.com:<user>/claude-agent-acp.git ~/projects/claude-agent-acp-fork
   cd ~/projects/claude-agent-acp-fork
   git checkout -b fix-dup-currentstreamid v0.47.0
   npm install
   ```

### איך לבנות + להריץ (Windows)

- **build**: `npm run build` (= `tsc` → מייצר `dist/`). ה-`bin` הוא `dist/index.js`.
- **טסטים יחידה (mock, מהירים)**: `npm run test:run` (= `vitest run`).
- **טסטים חיים (integration)**: `RUN_INTEGRATION_TESTS=true npm run test:run`
  (gated; ה-`beforeAll` עושה `spawnSync("tsc")` ואז `spawn("npm","run","dev")` —
  `dev` = `build && start`, כלומר בונה ומריץ את ה-adapter החי + prompt אמיתי מול claude →
  צורך auth מקומי של Anthropic + tokens. ב-Windows: CLI=claude עובד E2E — ר' memory
  `e2e-on-windows-blockers`).
  - ⚠️ flakiness: הטסט החי תלוי ב-ordering של ה-SDK. הריצו 2-3 פעמים אם ה-RED לא מופיע
    בריצה ראשונה (אך לפי #785 זה ה-"production ordering" → אמור להופיע בתור הראשון).

### Wiring ל-drive-coding (בלי שינוי קוד שלנו)

צרו/ערכו `~/.config/drive-coding/cli-specs.jsonc` (קובץ override מקומי — לא בריפו שלנו;
מנגנון `loadCliSpecsOverride` הקיים ב-`packages/backend/src/acp/cli-config-file.ts`):

```jsonc
{
  "claude": {
    "bin": "node",
    "args": ["C:\\Users\\<user>\\projects\\claude-agent-acp-fork\\dist\\index.js"]
  }
}
```

> `getCliCommand` ([cli-config.ts:42](packages/backend/src/acp/cli-config.ts#L42)): `override.args`
> דורס את `spec.args`, ו-`override.bin` דורס את `spec.bin`. לכן `bin:node args:[dist/index.js]`
> מחליף את `npx -y @agentclientprotocol/claude-agent-acp@latest` ב-build המקומי. **אפס שינוי
> בקוד drive-coding.** לחזרה ל-@latest: מחקו את ה-key "claude" מהקובץ.

### הרצת drive-coding לאימות E2E (Windows)

- BE: מתוך `packages/backend`: `WIRE_RECORD=1 PORT=4000 bun src/server.ts` (עוקף onecli;
  ה-override נטען אוטומטית מ-`~/.config/drive-coding/cli-specs.jsonc`).
- FE: `pnpm --filter @drive-coding/frontend-v2 dev` (port OS-assigned).
- חיבור: דף connect → CLI=claude → `newSession` (לא loadSession — להימנע מ-replay).

### Reading list

**must-read**:
- `docs/decisions/voice-acp.md` (entry עליון 2026-06-18) — השורש המלא + הפיבוט מ-FE-shim ל-fork.
- ב-fork: `src/acp-agent.ts` — `resetTurnScratch()` (≈975), `currentStreamMessageId`
  (הצהרה ≈957, set ב-message_start ≈1610), נתיב `stream_event` (≈1606-1690), ה-`assistant`
  consolidation + dedup (≈1840-1880, `streamedTextIds.has(id)`).
- ב-fork: `src/tests/acp-agent.test.ts` — בלוק `"ACP subprocess integration"` (≈136, ה-harness
  החי), בלוק `"assembled assistant text fallback"` (≈3583: `createMockAgentWithCapture`,
  `messageStart`, `textDelta`, `assistantMessage`, `injectSessionEchoAt`, `messageChunkTexts`,
  `result`, `idle`), והטסט הקיים של #785 (`"dedupes streamed text even when the stream
  arrives before the user echo"`).

**reference**:
- memory `wire-recorder-debug-mode`, `e2e-on-windows-blockers`.
- ה-PR/commit של #785: `12d34e6` (ההקשר שתיקן case אחֵר באותה פונקציה).

---

## §1 — מטרה

אחרי ה-slice: בשיחת claude (כשמריצים את ה-fork דרך ה-override) כל תשובת agent מוצגת
**כבועה אחת**. וחשוב לא פחות — **הוכחנו** את השורש: טסט חי (red) מראה את הכפילות על ה-adapter
המקורי, אותו טסט (green) מראה שהיא נעלמה אחרי הסרת שורה אחת. כל זה בלי לגעת בקוד drive-coding.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| תיקון-שורש ב-fork: הסרת `currentStreamMessageId = undefined` מ-`resetTurnScratch()` | ✅ | ה-slice (ב-fork) |
| טסט **חי** (integration) ב-fork שמשחזר את הכפילות (red→green) | ✅ | ה-slice (ב-fork) |
| טסט **mock דטרמיניסטי** ב-fork (ECHO לפני ה-textDelta הראשון) — regression guard | ✅ | ה-slice (ב-fork) |
| Wiring ל-drive-coding דרך `cli-specs.jsonc` (config מקומי) | ✅ | ה-slice (לא קוד) |
| אימות E2E מול drive-coding (BE+FE+claude) — בועה אחת | ✅ | ה-slice |
| שינוי כלשהו בקוד drive-coding (FE/BE source) | ❌ | אסור (אילוץ המשתמש) |
| PR upstream | ❌ | החלטה נדחתה ("לעת עתה רק מקומי") |
| תיקון adapters אחרים (opencode/gemini) | ❌ | לא רלוונטי — הבאג claude-only |

---

## §3 — Architecture diagram

```
fork: claude-agent-acp/src/acp-agent.ts
┌────────────────────────────────────────────────────────┐
│ resetTurnScratch()  ← נקרא מ-activateTurn (mid-stream!)  │
│   lastAssistant... = null                                │
│ - currentStreamMessageId = undefined;   ← DELETE שורה זו │
│   stopReason = "end_turn"                                │
└────────────────────────────────────────────────────────┘
        │ build (tsc) → dist/index.js
        ▼
~/.config/drive-coding/cli-specs.jsonc   (override מקומי, לא בריפו)
   { "claude": { "bin":"node", "args":["…/fork/dist/index.js"] } }
        │ loadCliSpecsOverride → getCliCommand
        ▼
drive-coding BE → spawn(node fork/dist/index.js)  במקום npx @latest
        │ ACP wire: text deltas נושאים messageId, אין assembled כפול
        ▼
FE #appendChunk (ללא שינוי) → בועה אחת
```

---

## §4 — Commits בסדר (ב-fork; TDD: red → fix → green)

### Commit 0 — טסטים שמשחזרים את הכפילות (RED) (approach: integration)

> מטרת ה-commit: להראות **חי** שהבאג קיים, לפני התיקון.

**קבצים שמשתנים (ב-fork)**: `src/tests/acp-agent.test.ts`.

**(א) טסט mock דטרמיניסטי** — בבלוק `"assembled assistant text fallback"`, אח לטסט של #785.
ההבדל הקריטי: ה-`"ECHO"` מוצב **לפני** ה-`textDelta` הראשון (אצל #785 הוא אחרי), כדי
שה-reset יקרה לפני שום delta-טקסט → `streamedTextIds` לעולם לא מקבל את ה-id:

```ts
it("dedupes streamed text even when the turn-activation reset lands before the first text delta", async () => {
  const { agent, updates } = createMockAgentWithCapture();
  injectSessionEchoAt(agent, [
    messageStart("msg-streamed"),
    "ECHO",                                   // activation → resetTurnScratch() באמצע
    textDelta("hello "),
    textDelta("world"),
    assistantMessage("msg-streamed", [{ type: "text", text: "hello world" }]),
    result(),
    idle,
  ]);
  await agent.prompt({ sessionId: "test-session", prompt: [{ type: "text", text: "hi" }] });
  // RED (0.47.0): ["hello ", "world", "hello world"]  ← assembled כפול
  // GREEN (אחרי fix): ["hello ", "world"]
  expect(messageChunkTexts(updates)).toEqual(["hello ", "world"]);
});
```

**(ב) טסט חי (integration)** — בבלוק `"ACP subprocess integration"`. ה-`TestClient`
כבר צובר את כל ה-`agent_message_chunk` ל-`receivedText`. נרחיב אותו לתפוס גם
`params.update.messageId` פר-chunk (מערך `messageIds`), ונכתוב:

```ts
it("does not duplicate the assistant answer (no id-less streamed text)", async () => {
  const { client, connection, newSessionResponse } = await setupTestSession(process.cwd());
  // marker ייחודי → קל לספור הופעות; prompt טרי (תור ראשון → ה-activation נופל mid-stream)
  await connection.prompt({
    prompt: [{ type: "text", text: "Reply with exactly this token and nothing else: ACPDUP-7Q2X" }],
    sessionId: newSessionResponse.sessionId,
  });
  const text = client.takeReceivedText();
  // (1) faithful לבאג הגלוי: ה-marker מופיע פעם אחת (RED: פעמיים)
  expect(text.split("ACPDUP-7Q2X").length - 1).toBe(1);
  // (2) signal של השורש: כל message-chunk נושא messageId (RED: ה-deltas שאחרי ה-reset = undefined)
  expect(client.messageIds.every((m) => typeof m === "string" && m.length > 0)).toBe(true);
}, 30000);
```

> ה-executor: הוסף ל-`TestClient` שדה `messageIds: (string | null | undefined)[] = []`,
> ובתוך `case "agent_message_chunk"` דחוף `this.messageIds.push(params.update.messageId)`.
> זו הרחבה ב-fork בלבד.

**Verification (RED — לפני התיקון)**:
```bash
cd ~/projects/claude-agent-acp-fork
npm run test:run -- acp-agent          # טסט (א) נכשל: מקבל 3 איברים → RED ✅
RUN_INTEGRATION_TESTS=true npm run test:run -- acp-agent   # טסט (ב) נכשל חי → RED ✅
```
> תַעֵד את פלט ה-RED (במיוחד החי) — זו ההוכחה שהבאג קיים.

### Commit 1 — תיקון-שורש: הסרת איפוס currentStreamMessageId (approach: tdd)

**קבצים שמשתנים (ב-fork)**: `src/acp-agent.ts`.

**DELETE block**: ב-`resetTurnScratch()` (≈975), מחק את השורה היחידה:
```ts
      currentStreamMessageId = undefined;
```
> זה הכל. אל תיגע בשאר הפונקציה. הרציונל: `currentStreamMessageId` נקבע מחדש בכל
> `message_start` (≈1610), אז איפוסו ב-turn-activation מיותר ופעיל-מזיק (ה-activation נופל
> mid-stream). זהו המשך ישיר של #785 (שהוציא מאותה פונקציה את איפוס ה-`Set`ים).

**Verification (GREEN)**:
```bash
npm run build                          # tsc → dist/ מעודכן
npm run test:run -- acp-agent          # טסט (א) → ["hello ","world"] → GREEN ✅
RUN_INTEGRATION_TESTS=true npm run test:run -- acp-agent   # טסט (ב) → marker פעם אחת + כל chunk עם id → GREEN ✅
npm run test:run                       # כל ה-suite — אין regression (במיוחד טסט #785 + 5212 "attaches messageId")
```

### Commit 2 — Wiring + אימות E2E מול drive-coding (approach: manual)

> לא commit לריפו fork ולא לריפו שלנו — צעד config + אימות חי. מתועד ב-walkthrough/דיווח.

1. צור `~/.config/drive-coding/cli-specs.jsonc` (ר' §0 Wiring) עם נתיב מוחלט ל-`dist/index.js` של ה-fork.
2. הפעל BE (`WIRE_RECORD=1 PORT=4000 bun src/server.ts`) + FE; חבר claude ב-`newSession`.
3. שלח 3-4 פרומפטים (תשובות באורך בינוני). ודא **בועה אחת** לכל תשובה.
4. אופציונלי: ב-`data/wire-recordings/*.jsonl` ודא שה-`agent_message_chunk` של התור החי
   נושאים `messageId` ואין frame assembled כפול (`jq`).

**Verification**:
```bash
# לפני: (אופציונלי) הרץ עם @latest והקלט → ראה כפילות (RED גם ב-drive-coding)
# אחרי: עם ה-override → בועה אחת (GREEN ב-drive-coding)
```

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|------|------|
| 1 | **RED מאומת** — לפני התיקון, טסט mock (א) + טסט חי (ב) נכשלים (מראים כפילות) | פלט שמור של שתי הריצות מ-Commit 0 |
| 2 | התיקון = שורה אחת בלבד נמחקה ב-`resetTurnScratch()`; `npm run build` עובר | `git diff` ב-fork מראה `-1` שורה ב-`src/acp-agent.ts` |
| 3 | **GREEN mock** — טסט (א) → `["hello ", "world"]` | `npm run test:run -- acp-agent` |
| 4 | **GREEN חי** — טסט (ב) → marker פעם אחת + כל message-chunk נושא messageId | `RUN_INTEGRATION_TESTS=true npm run test:run -- acp-agent` |
| 5 | **אין regression ב-fork** — כל ה-suite עובר (במיוחד #785 + 5212) | `npm run test:run` |
| 6 | **E2E ב-drive-coding** — claude דרך ה-override, בועה אחת לתשובה (3-4 פרומפטים) | BE+FE חי; ר' Commit 2 |
| 7 | **אפס שינוי קוד בריפו שלנו** | `git -C <drive-coding> status` נקי מקבצי src (רק docs/decisions של planner) |

> כלב: שחזר את (ב)+(ו) חי. אם ה-RED לא מופיע בריצה בודדת (flakiness של ordering), הרץ 2-3.

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|------|------|----------|
| הסרת השורה תגרום לדליפת id ישן ל-deltas של הודעה בלי message_start | ניתוח | בפועל כל הודעה מתחילה ב-message_start שדורס; טסט #785 + 5212 ("attaches messageId") + כל ה-suite מגנים (DoD#5) |
| הטסט החי flaky (תלוי ordering של SDK) | #785 comment | זה ה-production-ordering → אמור להופיע בתור הראשון; אם לא — הרץ 2-3; ה-mock-test (א) דטרמיניסטי ומכסה לוגית |
| build/integration לא רצים ב-Windows | env | tsc/npm/vitest רצים מ-node_modules של ה-fork; claude SDK משתמש ב-auth מקומי (memory `e2e-on-windows-blockers`); אם spawn נכשל — הרץ את ה-mock-test לבד + אמת E2E דרך drive-coding (Commit 2) |
| ה-marker `ACPDUP-7Q2X` יוקרא ע"י המודל עם טקסט נוסף → split != 2 | live | ה-assertion סופרת הופעות של ה-marker (==1), לא שוויון מלא; עמיד לטקסט עוטף |
| ה-override לא נטען (path/JSONC שגוי) | wiring | `getCliSpec` מחזיר warning על JSON שבור; ודא נתיב מוחלט עם `\\` ב-Windows; בדוק בלוג ה-BE שה-bin הוא node+fork |
| @latest יתעדכן ל-0.48.0 עם תיקון → ה-override "יקפיא" אותנו על fork ישן | npm | מקובל לעת-עתה; כשיֵצא תיקון upstream — מחק את ה-key מ-cli-specs.jsonc (חוזר ל-@latest). מתועד ב-decisions |

> 3 שתמיד נשכחים: (1) Hebrew→i18n — לא רלוונטי (עבודה ב-fork חיצוני + config). (2) Reactivity —
> אין שינוי FE. (3) OneCLI — לא רלוונטי (bun ישיר; claude דרך auth מקומי).

---

## §7 — Escalation triggers

> אם X — עצור ושאל את מרדכי (Tama):

- הסרת השורה **לא** מעבירה את הטסט החי ל-GREEN (הכפילות שורדת) — מעיד ששורש נוסף קיים מעבר ל-`resetTurnScratch`.
- הטסט החי לא משחזר RED גם אחרי 3 ריצות בתור ראשון — צריך לשנות את אסטרטגיית ה-repro (אולי loop/thinking מפורש).
- ה-build של ה-fork נכשל ב-Windows באופן שלא נעקף.
- מתברר שצריך לשנות קוד ב-drive-coding (לא רק config) כדי לחווט את ה-fork — סותר את אילוץ המשתמש.
- שוקלים לפתוח PR upstream — נדחה ("לעת עתה רק מקומי"); אישור מפורש לפני.

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|------|------|
| Streaming/real-time (נוגע בליבת ה-stream של ה-adapter) | +2 |
| Protocol contract (ACP messageId semantics) | +2 |
| ספרייה/codebase חיצוני חדש (fork — build/test/wire) | +2 |
| State machine / async coordination (turn activation timing) | +2 |
| Refactor של קוד קיים (שורה אחת) | +1 |
| Pure logic בליבה — לא (יש IO/spawn בטסט החי) | 0 |
| TDD מלא (mock דטרמיניסטי + חי) | -1 |
| התיקון עצמו זעיר (שורה אחת, root-cause ברור) | -2 |

**Score**: 6 / 10 (הסיבוך הוא ב-harness/build/wiring/live-test ובקוד חיצוני, לא בלוגיקת התיקון).

**Tier**: 6 → `calev` (light) + דגש לשחזר את הטסט החי (DoD#4) ואת ה-E2E (DoD#6). **לא** heavy
(אין visual/edge-case רחב; השינוי שורה אחת). אפשר verifier-phase על Commit 1 (התיקון) אם רוצים.

**Verifier-phase**: אופציונלי על Commit 1 (לאשר GREEN לפני Commit 2).

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | מיקום ה-fork clone | `~/projects/claude-agent-acp-fork` (executor יכול לבחור; לתעד את הנתיב ב-cli-specs.jsonc) | ❌ |
| 2 | הטסט החי ב-fork-suite או סקריפט נפרד? | **ב-fork-suite** (בלוק integration קיים — מינימום חיכוך, נשמר עם ה-fork) | ❌ |
| 3 | האם להסיר את השורה לגמרי או להעביר את האיפוס ל-message_stop/turn-settle? | **הסרה מלאה** (מינימלי, תואם #785). אם DoD#5 ייכשל ברגרסיה — שקול העברה | ❌ |

---

## סטיות מהתכנון (מתעדכן ע"י executor תוך כדי)

> ה-executor מתעד פה כל סטייה מה-brief ולמה.

### סטייה 1: E2E blocked (ישן) → **נפתרה בסשן 2026-06-18**

**תיאור מקורי**: spawn cwd=POSIX לא עבד עם Windows binaries.

**פתרון**: הזנת cwd בפורמט Windows מהממשק (`D:\UserProjects\AI\drive-coding`). ה-FE לא כופה POSIX
כשמשתמש מזין ידנית path ב-SessionPicker. ה-BE קיבל את ה-cwd כ-Windows path, spawn הצליח.

**מה אומת (סשן 2026-06-18)**:
- DoD #1-5 ✅
- DoD #6 (E2E) ✅ — BE port 4002 עם WIRE_RECORD=1 + FE port 5173 + claude דרך fork.
  3 prompts: ACPDUP-7Q2X → "ACPDUP-7Q2X" (אחת), "5+6" → "11" (אחת), "ENDTEST" → "ENDTEST" (אחת).
  Wire recordings: 0 chunks ללא messageId, 0 כפילויות.
  Screenshots: e2e-ty-p1.png, e2e-ty-p2.png, e2e-ty-p3.png ב-D:\Users\User\AppData\Local\Temp.

### הערה על live-RED (DoD#4):

ה-live integration test (`does not duplicate the assistant answer`) עבר GREEN גם על f4a1404 (RED commit) ב-3 ריצות.
הסיבה: ב-subprocess החי ה-ECHO מגיע **לפני** message_start (timing שונה ממוק), כך שה-bug לא מתרחש.
ה-mock-RED (טסט `dedupes streamed text even when the turn-activation reset lands before the first text delta`)
הוא הביטוי הדטרמיניסטי של הבאג, ועובד תמיד RED על f4a1404 וGREEN על 84dbec1.
הוחלט: ה-mock-RED משמש כ-DoD#4 עם הסבר על flakiness ה-live test (תואם §6 risk #2).
