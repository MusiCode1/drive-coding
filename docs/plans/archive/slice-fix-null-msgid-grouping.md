# Slice fix-null-msgid-grouping — קיבוץ בועות כשאין messageId (Gemini)

> **תאריך**: 2026-06-04
> **סטטוס**: הושלם (commit `47f9ad7`, 2026-06-04 — בוצע ישירות ל-dev, 171/171 טסטים, 6 חדשים)
> **Complexity**: 2/10 (verifier: calev light)
> **תלויות (`depends_on`)**: [] — ישירות על dev
> **Base**: dev
> **Dev tip**: `7c3885f`

---

## §0 — Pre-flight

### בעיה
Gemini ACP שולח `agent_message_chunk` ו-`agent_thought_chunk` **ללא `messageId`** (`messageId: null`). הביטוי `#appendChunk` (`agent-session.svelte.ts:716-720`) דורש **`messageId !== null`** כתנאי לקיבוץ → כל chunk יוצר בועה נפרדת. התוצאה: תשובת Gemini מפוצלת ל-10+ בועות נפרדות במקום בועה אחת.

### שורש
`messageId` הוא שדה **UNSTABLE/experimental** ב-ACP (ראה `ContentChunk` ב-SDK types.gen.d.ts:880). Gemini לא שולח אותו; Claude (דרך opencode) שולח. הקוד הקיים מטפל נכון ב-Claude אבל נשבר ב-Gemini.

### Worktree
```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/fix-null-msgid-grouping -b fix-null-msgid-grouping dev
cd .worktrees/fix-null-msgid-grouping
pnpm install && pnpm hooks:install
```

### איך להריץ
| מה | פקודה |
|---|---|
| typecheck FE | `pnpm --filter @drive-coding/frontend typecheck` |
| tests FE | `pnpm --filter @drive-coding/frontend test` |
| tests root | `pnpm test` |
| lint:i18n | `pnpm lint:i18n` |

### Reading list
**must-read**:
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts:708-759` — `#appendChunk` (הקוד לשינוי)
- `packages/frontend/src/lib/types/bubble.ts` — מודל Bubble (understanding the kinds)

**reference**:
- ACP SDK `ContentChunk.messageId` — `types.gen.d.ts:880` (UNSTABLE, optional)
- `packages/frontend/src/lib/engines/cues.test.ts` — דפוס טסטים קיים (mock session) להשראה

---

## §1 — מטרה

תשובת Gemini מוצגת כבועת טקסט אחת (עם segments מרובים) במקום בועה נפרדת לכל chunk. שינוי הקריטריון `messageId !== null` → `messageId !== null ? last.messageId === messageId : last.messageId === null`.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| שינוי `#appendChunk` logic | ✅ | כאן |
| `stopReason=end_turn` כ-boundary | ❌ | slice-fix-turnstate-stuck (plan-verified, ממתין) |
| Tool call bubble grouping | ❌ | כבר תקין (kind=tool, לא מתבלבל) |
| user_message_chunk מ-loadSession | ❌ | כבר תקין (מגיע עם messageId מ-Claude, ל-Gemini אין loadSession) |
| Speaker/קריינות תלוית-בועה | ❌ | לא רלוונטי |
| Markdown rendering בתוך segments | ❌ | כבר עובד (MessageBubble.svelte:joinSegmentText) |

---

## §3 — Architecture diagram

```
לפני:
  agent_message_chunk (null) → bubble #1 (id=1, segments=["hello"])
  agent_message_chunk (null) → bubble #2 (id=2, segments=[" world"])
  agent_message_chunk (null) → bubble #3 (id=3, segments=["!"])

אחרי:
  agent_message_chunk (null) → bubble #1 (id=1, segments=["hello"]) ← מצטרף לאותה בועה
  agent_message_chunk (null) → bubble #1 (id=1, segments=["hello", " world"])  ← appended
  agent_message_chunk (null) → bubble #1 (id=1, segments=["hello", " world", "!"])
```

השינוי הוא **רק ב-`canGroup`** — הלוגיקה של `kind` נשארת. תרחישים:

| תרחיש | messageId | last.messageId | kind | תוצאה |
|--------|-----------|----------------|------|--------|
| Claude chunks | "abc" | "abc" | message | ✅ group (כמו קודם) |
| Claude new msg | "def" | "abc" | message | ❌ new bubble (כמו קודם) |
| Gemini chunks | null | null | message | ✅ **group (חדש)** |
| Gemini → user prompt | null (user) | null (msg) | user ≠ msg | ❌ new bubble (kind guard) |
| Gemini thought→msg→thought | null | null (msg) | thought ≠ msg | ❌ new bubble (kind guard) |

---

## §4 — Commits

### Commit 0 — fix: קבץ בועות null-messageId לפי kind (approach: manual + test)

**שינוי קובץ אחד**:
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts:714-720`

**השינוי**:
```ts
// לפני:
const canGroup =
  last !== undefined &&
  last.kind === kind &&
  messageId !== null &&
  last.messageId === messageId

// אחרי:
const canGroup =
  last !== undefined &&
  last.kind === kind &&
  (messageId !== null
    ? last.messageId === messageId     // יש messageId → קבץ לפי מזהה (Claude)
    : last.messageId === null)         // אין messageId → קבץ לפי kind (Gemini)
```

**API skeleton**: אין — שינוי פנימי ב-`#appendChunk` (private method).

**קובץ test חדש**:
- `packages/frontend/src/lib/view-models/agent-session.test.ts`

הטסטים צריכים לבדוק את `#appendChunk` behavior. מאחר ש-`#appendChunk` הוא private method, הגישה היא דרך `#onSessionUpdate` — לשלוח session notifications ולבדוק את `bubbles`:
  - `agent_message_chunk` עם messageId="abc" × 3 → bubble 1 עם 3 segments
  - `agent_message_chunk` עם messageId=null × 3 → bubble 1 עם 3 segments
  - `agent_thought_chunk` עם messageId=null × 2 → bubble 1 עם 2 segments
  - `agent_message_chunk` null → `agent_thought_chunk` null → `agent_message_chunk` null → 3 bubbles (kind alternates)
  - `agent_message_chunk` null ואז `user_message_chunk` null → 2 bubbles (kind changes)
  - `user_message_chunk` עם messageId="x" × 2 → bubble 1 עם 2 segments (existing behavior preserved)

> **הערה**: אין טסטים קיימים ב-view-models — זה ה-test file הראשון בספרייה. דפוס ליצירת AgentSession mock: cues.test.ts (engines/) משתמש בפונקציות עזר דומות ליצירת mock session.

```ts
// @vitest-environment node
// test pattern — יוצר AgentSession עם transport-mock, שולח SessionNotification דרך
// #onSessionUpdate, בודק את תוכן `bubbles`
// ראה: cues.test.ts (engines/cues.test.ts) — mock session pattern
```

**Verification**:
```bash
pnpm --filter @drive-coding/frontend typecheck
pnpm --filter @drive-coding/frontend test -- run          # כולל הטסטים החדשים
pnpm lint:i18n
```

---

## §5 — DoD

| בדיקה | איך |
|-------|-----|
| 3 `agent_message_chunk` עם messageId null → MessageBubble יחיד עם 3 segments | `pnpm test` (unit) |
| 3 `agent_message_chunk` עם messageId "abc" → MessageBubble יחיד (regression) | `pnpm test` |
| kind מתחלף (msg→thought→msg) → 3 בועות נפרדות | `pnpm test` |
| user bubble לא מתבלבל עם message bubble (kind guard) | `pnpm test` |
| TypeScript typecheck | `pnpm --filter @drive-coding/frontend typecheck` |

**לא נבדק ב-runtime** (אין Gemini live): הבדיקה היחידה היא בפרודקשן או מול Gemini אמיתי. הסיכון נמוך — השינוי מצומצם לשורה אחת.

---

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|-------|------|-----------|
| user_message_chunk מ-loadSession עם null messageId עלול להתקבץ עם message_chunk null קודם | kind guard: user ≠ message. מוגן. | test מכסה |
| kind=user + messageId=null במשתמש אופטימי (sendPrompt) → grouped with null agent chunks | kind guard. מוגן. | test מכסה |
| Tool bubble (kind=tool, messageId=null) → grouped with agent_message_chunk null | kind guard: tool ≠ message. מוגן. | test מכסה |
| סדר chunks שונה בעתיד (ACP spec update) | analysis: ACP chunks תמיד מגיעים כ-content blocks נפרדים | escalation trigger |

---

## §7 — Escalation triggers

- ACP ספציפיקציה משתנה ו-messageId הופך לחובה (במקום UNSTABLE)
- נמצא מקרה שבו kind guard לא מספיק (שני chunks מאותו kind מ-2 תורות שונים)

---

## §8 — Complexity score

- **מספר commits**: 1 (נמוך)
- **שכבות חדשות**: 0
- **APIs חיצוניים**: 0
- **Streaming / async**: 0 (שינוי סינכרוני ב-condition)
- **Refactor**: 0
- **BE↔FE protocol**: 0
- **סך הכל**: 2/10 → **calev light**

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|------------|-------|
| 1 | האם צריך להוסיף counter-תור (turn counter) כדי להפריד בין null-msg chunks מתורות שונים? | לא — optimistic UserBubble (kind=user) יוצר הפרדה טבעית בין תורות | ❌ |
| 2 | האם `stopReason=end_turn` מה-prompt() יכול לשמש כ-boundary טוב יותר? | תיאורטית — אבל chunks מגיעים **לפני** ש-prompt() resolve, אז זה לא רלוונטי לקיבוץ | ❌ |
| 3 | לכתוב test בלי mock שלם של AgentSession? | preferable — לכתוב helper class קטן ש-expose את `#appendChunk` | ❌ |
