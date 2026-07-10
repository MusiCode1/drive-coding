# Slice A — claude-subagent-adapter-fork — תוכנית

> **תאריך**: 2026-07-05
> **סטטוס**: טיוטה
> **Complexity**: 7/10 (verifier: light — calev)
> **תלות**: אין (base = fork של upstream v0.55.0). מזין את `subagent-nested-bubble` (Slice B, FE — טרם brief).
> **⚠️ Repo**: מתבצע ב-**`MusiCode1/claude-agent-acp`** (fork), **לא** ב-drive-coding. drive-coding יצרוך את התוצאה כ-github-dep (כמו codex-acp).

---

## §1 — מטרה

היום ה-adapter `@agentclientprotocol/claude-agent-acp` **זורק** בכוונה את כל פעילות תת-הסוכן (Task/Agent tool): הוא עושה `break` על ארבעת אירועי ה-`system/task_*`, ומסנן את ה-`text`/`thinking` של הודעות תת-הסוכן ("keep dropping so subagent prose doesn't leak into the top-level feed"). התוצאה: ה-FE של drive-coding מקבל את קריאת ה-Task כ-`tool_call` יחיד עם JSON גולמי, בלי שם תת-הסוכן, בלי progress, בלי הפרוזה/המחשבות שלו.

אחרי הסבב הזה, ה-fork יהיה **צינור שקוף (lossless)**: אפס-זריקה. כל frame שה-upstream מפיל — task lifecycle ו-subagent prose — יעבור החוצה כ-`session/update` תחת `_meta.claudeCode` (namespace קיים), **בלי לאבד מידע ובלי לזהם את ה-feed הראשי** (התיוג `parentToolUseId` כבר קיים). ה-FE (Slice B) יקנן ויציג; ה-adapter רק מעביר.

עיקרון-על (הנחיית משתמשת 2026-07-05): **"לא לזרוק כלום — מה אכפת לנו להעביר כ-`_meta`."** ה-fork אינו מקבל החלטת-תצוגה; הוא מעביר raw, וה-FE/`provider-contract` בורר. ר' `docs/decisions/drive-coding.md` → `provider-adapter-split`.

---

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| task_* → `session/update` עם frame ב-`_meta` | ✅ | commit 1 |
| subagent `text`/`thinking` passthrough (הסרת filter) | ✅ | commit 2 |
| `prepare` script ל-build-on-install (github-dep) | ✅ | commit 0 |
| sync ה-fork מול upstream v0.55.0 | ✅ | commit 0 |
| **קינון/רינדור ב-FE** (בועה מקוננת, שם, progress, sticky-bottom) | ❌ | Slice B `subagent-nested-bubble` (drive-coding) |
| **נירמול ה-`_meta` ב-`provider-contract`** (raw→normalized) | ❌ | Slice B / `provider-package-organization` |
| **חיבור drive-coding ל-github-dep** (`package.json` של drive-coding) | ❌ | Slice B commit 0 (זהו gate של B, לא A) |
| **opencode subagent** | ❌ | spike נפרד (opencode משטח ל-tool_call יחיד — ר' decisions) |
| שינוי ה-gates של `parent_tool_use_id === null` על ה-**top-level** stream (1993/2009/2035/2165/2254) | ❌ | **לא לגעת** — הם מגנים על ה-feed הראשי מזיהום. שינוי שלהם = רגרסיה |

> **הגנת-scope**: השינוי הוא **שתי נקודות בלבד** ב-`src/acp-agent.ts`. אל תיגע ב-gates של ה-top-level stream, ואל תמפה/תנרמל את ה-frames בתוך ה-adapter — passthrough גולמי בלבד.

---

## §3 — Architecture diagram

```
Claude Code CLI (stream-json)
      │  SDKMessage stream (task_started/progress/notification/updated + assistant{parent_tool_use_id})
      ▼
@anthropic-ai/claude-agent-sdk  query()
      │
      ▼
┌─────────────────────────────────────────────────────────┐
│ FORK: @agentclientprotocol/claude-agent-acp              │
│ src/acp-agent.ts                                          │
│                                                          │
│  system handler @1680  case task_*: break   ← ❌ זורק    │
│      └─► ✅ session/update + _meta.claudeCode.task=frame  │  ← חדש (commit 1)
│                                                          │
│  assistant @2315  filter(!text && !thinking) ← ❌ זורק   │
│      └─► ✅ העבר content כמות-שהוא                        │  ← חדש (commit 2)
│              (toAcpNotifications כבר מצמיד                │
│               _meta.claudeCode.parentToolUseId @5122)    │
└─────────────────────────────────────────────────────────┘
      │  session/update (ACP notifications, כולל _meta)
      ▼
drive-coding BE (dumb-pipe) ──► FE (Slice B: קינון+רינדור)
```

---

## §4 — Commits בסדר

### Commit 0 — sync fork ל-v0.55.0 + prepare script (approach: manual)

**רקע**: ה-fork `MusiCode1/claude-agent-acp` תקוע ב-~0.48 (7 גרסאות מאחור). ה-branches הישנים (`fix-dup-currentstreamid` וכו') כבר לא רלוונטיים (fix-dup נפתר upstream ב-0.52). מסנכרנים ל-v0.55.0 ופותחים branch נקי `drive-coding`.

**צעדים**:
```bash
# clone/worktree של ה-fork (לא drive-coding!)
git clone git@github.com:MusiCode1/claude-agent-acp.git
cd claude-agent-acp
git remote add upstream https://github.com/agentclientprotocol/claude-agent-acp.git
git fetch upstream --tags
git checkout -b drive-coding v0.55.0     # branch נגזר מ-tag upstream, לא מ-main הישן
npm install
npm run build && npm test                # baseline ירוק לפני שינוי
```

**קובץ שמשתנה**: `package.json` — הוסף `prepare` (build-on-install ל-github-dep, תבנית codex-acp):
```json
"scripts": {
  "prepare": "npm run build",
  ...
}
```
> תבנית מ-`MusiCode1/codex-acp#drive-coding` (`"prepare": "npm run build"`, `main: dist/index.js`). ללא זה, `github:MusiCode1/claude-agent-acp#drive-coding` יגיע בלי `dist/` ו-import ייכשל ב-drive-coding.

**Verification**:
```bash
npm run build && npm test    # שניהם ירוקים
node -e "require('./package.json').scripts.prepare"   # קיים
git log --oneline upstream/main -1   # מאשר שה-base הוא v0.55, לא 0.48
```

---

### Commit 1 — task_* passthrough (approach: TDD)

**מטרה**: להחליף את ה-`break` על ארבעת ה-`task_*` בפליטת `session/update` שנושא את ה-frame הגולמי ב-`_meta.claudeCode.task`.

**קובץ שמשתנה**: `src/acp-agent.ts` — סביב שורה **1680-1684** (ה-`case "task_started"/"task_notification"/"task_progress"/"task_updated": break`).

**עיצוב ה-envelope** (ר' §9 Q1): מעטפה = `tool_call_update` על `toolCallId = message.tool_use_id` (ה-`tool_use` של ה-Agent call — קיים על שלושת ה-frames המרכזיים; `task_updated` נושא רק `task_id` — ר' Q2), עם ה-frame הגולמי תחת `_meta.claudeCode.task`. זה משתמש ב-container טבעי (ה-Task כבר מרונדר כ-tool_call ב-FE) ונשאר passthrough גולמי. ⚠️ **תבנית להעתקה = `terminal_output`, לא `tool_progress`** (finding אביגיל r1 #2): `tool_progress` דווקא **כן** נושא `status:"in_progress"`; המסלול שפולט `tool_call_update` **בלי** status הוא `terminal_output` (חפש `terminal_output` בקובץ).

**API skeleton** — ⚠️ **קריטי (finding אביגיל r1 #1)**: ב-upstream @~1676-1684 ארבעת ה-`task_*` חולקים `break` **יחיד** עם ארבעה שכנים — `hook_started`/`hook_progress`/`hook_response`/`files_persisted`. **חובה לשמר אותם עם `break` נפרד**, אחרת הפרדת ה-block מפילה את ה-hook handling (silent regression). ה-skeleton המלא:
```ts
// שכנים שנשארים כמות-שהם — אל תוריד אותם מה-switch, השאר break נפרד:
case "hook_started":
case "hook_progress":
case "hook_response":
case "files_persisted":
  break;
// רק ה-task_* מקבלים passthrough:
case "task_started":
case "task_notification":
case "task_progress":
case "task_updated": {
  // Lossless passthrough — the FE/provider-contract decides rendering.
  const toolUseId =
    "tool_use_id" in message ? message.tool_use_id : undefined;
  await this.client.sessionUpdate({
    sessionId: message.session_id,
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: toolUseId ?? message.task_id,   // task_updated has task_id only
      _meta: { claudeCode: { task: message } },   // raw frame, verbatim
    },
  });
  break;
}
```
> **status אינו חובה** — `@agentclientprotocol/sdk` **1.1.0** הופך את `status` ב-`ToolCallUpdate` ל-**optional** (finding אביגיל r1 #3). לכן `tool_call_update` עם `toolCallId`+`_meta` בלבד תקין; Q1 סגור. עדיין ודא ב-`npm run build` (tsc) שה-types עוברים.

**Test** (`src/tests/acp-agent.test.ts` — הרחב את ה-suite הקיים): הזרם `task_started`/`task_progress`/`task_notification`/`task_updated` mock, ואמת ש-`client.sessionUpdate` נקרא עם `update._meta.claudeCode.task` השווה ל-frame, ו-`toolCallId` נכון. (ה-input/output ידועים מראש → TDD טהור.)

**Verification**:
```bash
npm test -- acp-agent    # ה-test החדש ירוק
npm run build            # tsc עובר (types תקינים)
```

---

### Commit 2 — subagent prose passthrough (approach: TDD)

**מטרה**: להסיר את ה-filter שזורק `text`/`thinking` של הודעת תת-סוכן. אחרי ההסרה, התוכן עובר ל-`toAcpNotifications` שכבר מצמיד `_meta.claudeCode.parentToolUseId` (מאומת בקוד: string path @4863, array path @5122) → אין זיהום.

**קובץ שמשתנה**: `src/acp-agent.ts` — שורות **2315-2322**. הבלוק:
```ts
} else if (message.type === "assistant") {
  // Subagent assistant message (`parent_tool_use_id !== null`)...
  // keep dropping it so subagent prose doesn't leak into the top-level feed.
  content = message.message.content.filter(
    (item) => item.type !== "text" && item.type !== "thinking",
  );
}
```
**אחרי** — הסר את ה-branch כליל, כך שהמסלול נופל ל-`else { content = message.message.content }` (העבר הכל):
```ts
// Subagent prose now flows through verbatim; toAcpNotifications tags each
// chunk with _meta.claudeCode.parentToolUseId so the FE nests it (no leak).
} else {
  content = message.message.content;
}
```
> **לא לגעת** ב-`parentToolUseId: message.parent_tool_use_id` שכבר מועבר ל-`toAcpNotifications` בשורה ~2336 — זה מה שמונע זיהום.

**Test** (`src/tests/acp-agent.test.ts`): הזרם `assistant` message עם `parent_tool_use_id: "toolu_X"` ותוכן `[{type:"text"},{type:"thinking"}]`. אמת ש-(א) פולט `agent_message_chunk`/`agent_thought_chunk` (לא נזרק), ו-(ב) לכל אחד `update._meta.claudeCode.parentToolUseId === "toolu_X"`. + regression: `assistant` עם `parent_tool_use_id: null` (top-level) לא מקבל `parentToolUseId` ב-_meta (לא נשבר).

**Verification**:
```bash
npm test -- acp-agent
npm run build
```

---

## §5 — DoD verifiable

| בדיקה | איך |
|---|---|
| ה-base הוא v0.55.0 (לא 0.48) | `git merge-base --is-ancestor v0.55.0 HEAD && echo OK` |
| `prepare` קיים ב-package.json | `node -e "process.exit(require('./package.json').scripts.prepare?0:1)"` |
| task_* → `_meta.claudeCode.task` | test חדש ב-`acp-agent.test.ts` ירוק (4 subtypes) |
| subagent prose עובר + מתויג parent | test חדש ירוק (text+thinking, `parentToolUseId` ב-_meta) |
| top-level stream לא נשבר | כל ה-suite הקיים של `acp-agent.test.ts` ירוק (regression) |
| build נקי | `npm run build` (tsc) exit 0 |
| lint/format | `npm run check` (eslint + prettier) exit 0 |
| **(gate ל-Slice B, לא ל-A)** github-dep נבנה ב-drive-coding | ידני ב-B: `pnpm add github:MusiCode1/claude-agent-acp#drive-coding` → `dist/` נוצר |

> **אימות-frames-חי** (שה-`_meta` אכן מגיע ל-FE דרך drive-coding) הוא **DoD של Slice B**, לא של A — דורש סביבה חיה + חיבור ה-github-dep. Slice A נאמת ב-unit בלבד.

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| ~~schema לא מקבל `_meta`-only (בלי `status`)~~ **נסגר** | ACP SDK 1.1.0 | `status` optional ב-`ToolCallUpdate` (אביגיל r1 #3); Commit 1 עדיין gate על build (tsc) |
| הפרדת ה-`task_*` שוברת את ה-`break` של `hook_*`/`files_persisted` השכנים | אביגיל r1 #1 | ה-skeleton ב-Commit 1 מציג אותם במפורש עם `break` נפרד; regression = כל ה-suite הקיים ירוק |
| הסרת ה-filter מזהמת את ה-top-level feed | הערת upstream 2318 | מאומת שלא: `parentToolUseId` מוצמד ל-_meta (@4863/@5122); regression-test על `parent===null` |
| ה-fork sync מוחק branches ישנים בטעות | fork ב-0.48 | branch `drive-coding` נגזר מ-`v0.55.0` tag; ה-branches הישנים נשארים, פשוט לא בשימוש |
| build-on-install של github-dep לא רץ (dist חסר) | github-dep pitfall | `prepare` script (תבנית codex-acp מאומתת); DoD בודק קיום |
| upstream ישנה שוב את מבנה ה-frames | adapter חיצוני | ה-passthrough גולמי (`task: message`) עמיד לשינויי-שדות; רק שינוי ה-subtypes ישבור |

> **הערה — לא i18n/Svelte/OneCLI**: הסבב כולו ב-repo ה-adapter (TS טהור, אין UI, אין SDK חיצוני של drive-coding). שלושת הגוצ'ות הרגילות לא רלוונטיות כאן.

---

## §7 — Escalation triggers

עצור ושאל את מרדכי ב-parent task אם:
- ~~ה-`tool_call_update` schema לא מקבל `_meta` בלי `status`~~ — **נסגר** (SDK 1.1.0: `status` optional, אביגיל r1 #3).
- ה-`task_updated` frame אינו נושא `tool_use_id` **ואף** `task_id` שאפשר לתאם לו tool_call (משפיע על הקינון).
- הסרת ה-filter שוברת test קיים ב-suite (סימן שה-top-level כן תלוי בזה — בניגוד להנחה).
- ה-`hook_*`/`files_persisted` השכנים אינם חולקים את ה-`break` כפי שה-brief מניח (סטה מ-@1676-1684 שאומת).
- `npm run build` נכשל בגלל שינוי types של ה-SDK בין 0.48→0.55 (ייתכן שברירת-מחדל של upstream השתנתה).

---

## §8 — Complexity score

- commits: 3 (נמוך)
- שכבות חדשות: 1 (ה-adapter — repo לא-מוכר) 
- APIs חיצוניים: 0 (ה-SDK כבר שם)
- Streaming: לא (unit-testable, input/output ידועים)
- protocol change (BE↔FE via `_meta`): **+2**
- repo זר + build/publish flow: +1

**Score: 7/10 → verifier: light (calev)**. הליבה TDD-טהורה (2 מתוך 3 commits), אין UI/streaming/audio. ה-`+2` של protocol מאוזן ע"י היעדר סביבה-חיה ב-A (האימות החי ב-Slice B). אם calev מהסס — light מספיק כי כל ה-DoD unit/build-verifiable.

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל מוצעת | חוסם? |
|---|---|---|---|
| 1 | ✅ **סגור** — envelope ל-task_*: `tool_call_update`+`_meta` על `tool_use_id`. | נבחר: `tool_call_update` עם `_meta.claudeCode.task`. SDK 1.1.0 מאשר `status` optional (אביגיל r1 #3); תבנית-העתקה = `terminal_output` (לא `tool_progress`, #2). | ✅ נסגר |
| 2 | `task_updated` נושא רק `task_id` (לא `tool_use_id`) — איך מתאמים ל-tool_call? | `toolCallId: task_id` כ-fallback; ה-FE יתאם דרך מפת task_id↔tool_use_id שנבנתה מ-`task_started` | ❌ |
| 3 | האם לפלוט גם `system/thinking_tokens` של תת-סוכן, או רק task_*? | לא בסבב זה — רק ה-4 task_* + prose. thinking_tokens הוא top-level ומטופל בנפרד | ❌ |
| 4 | pin לגרסת ה-github-dep — `#drive-coding` (branch) או `#<sha>`? | `#drive-coding` בזמן פיתוח; pin ל-sha ב-Slice B לפני merge (יציבות) | ❌ (החלטת B) |
