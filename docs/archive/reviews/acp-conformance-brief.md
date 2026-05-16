# ACP Conformance Check — Brief

> **מטרה:** לבדוק אם המימוש שלנו של ACP client (ב-`packages/backend/src/acp/`) תואם ל-spec הרשמי. **בדיקה בלבד — אסור לתקן קוד.**

> **תוצר:** קובץ אחד — `docs/reviews/acp-conformance.md`

> **CWD:** `/home/user/projects/voice-acp-v2`

> **מבצע:** Yolo executor (Sonnet 4-6)

> **רקע:** Slices 1-5 הושלמו (commits `68a2b18..9b7c912`). ה-UI עולה, ה-bridge spawn-ים, אבל יצירת agent חדש דרך ה-form נכשלת עם `spawn/attach failed: ACP connection closed`. Tama (planner) חושדת שזה בגלל `clientCapabilities: {}` ריקות. צריכה אישור או הפרכה, וגם רשימת כל הסטיות האחרות מ-ACP spec.

---

## 1. מקורות אמת (קרא לפי הסדר)

### 1.1 SDK Types (canonical schema)
- `packages/backend/node_modules/@agentclientprotocol/sdk/dist/schema/types.gen.d.ts` — **כל** ה-types של ה-protocol
- `packages/backend/node_modules/@agentclientprotocol/sdk/dist/acp.d.ts` — interfaces של Agent + Client
- `packages/backend/node_modules/@agentclientprotocol/sdk/dist/examples/agent.ts` — דוגמת mock agent (D49)

### 1.2 ACP spec הרשמי (סדר עדיפויות)

**חובה:**
1. https://agentclientprotocol.com/protocol/overview.md — דף ה-overview עם message flow
2. https://agentclientprotocol.com/protocol/initialization.md — capability negotiation
3. https://agentclientprotocol.com/protocol/session-setup.md — newSession + loadSession
4. https://agentclientprotocol.com/protocol/prompt-turn.md — full prompt lifecycle
5. https://agentclientprotocol.com/protocol/content.md — message chunks (text/thought/agent/user)
6. https://agentclientprotocol.com/protocol/tool-calls.md — tool execution flow
7. https://agentclientprotocol.com/protocol/file-system.md — fs/read fs/write
8. https://agentclientprotocol.com/protocol/schema.md — full schema reference

**מועיל:**
9. https://agentclientprotocol.com/protocol/terminals.md
10. https://agentclientprotocol.com/protocol/session-modes.md
11. https://agentclientprotocol.com/protocol/agent-plan.md
12. https://agentclientprotocol.com/protocol/slash-commands.md
13. https://agentclientprotocol.com/protocol/extensibility.md

**רקע חשוב:**
14. https://agentclientprotocol.com/get-started/architecture.md

השתמש ב-Webfetch כדי לקרוא כל URL.

### 1.3 הקוד שלנו (subjects ל-conformance)

קריטיים (קרא כולם במלואם):
- `packages/backend/src/acp/acp-transport.ts` — initialize + newSession orchestration
- `packages/backend/src/acp/client-impl.ts` — implementations של callbacks ל-Agent calls
- `packages/backend/src/acp/ws-streams.ts` — NDJSON adapter
- `packages/backend/src/acp/bridge-manager.ts` — spawn lifecycle
- `packages/backend/src/acp/cli-config.ts` — CLI mapping
- `packages/backend/src/app/agent-session.ts` — message flow consumer
- `packages/core/src/ports.ts` — AcpTransport interface

משני (read partial):
- `packages/backend/src/voice/pipeline.ts` — איך משתמשים ב-acpTransport.prompt
- `packages/frontend/src/lib/stores/agent-session.svelte.ts` — מה הfrontend מצפה לקבל
- `packages/core/src/schemas/ws-messages.ts` — schemas של messages

---

## 2. תחומי בדיקה (כל אחד חייב כיסוי)

### A. Initialization
- מה ה-spec דורש ב-`InitializeRequest` (protocolVersion, clientCapabilities, clientInfo?)?
- האם אנחנו שולחים כל מה שצריך?
- מה ה-`InitializeResponse` מחזיר ומה מאיתנו מתעלם?
- **המוקד:** `clientCapabilities` — מה השדות, מה האפקט אם ריק?

### B. Authentication
- מה זה `authMethods` ש-opencode מחזיר ב-initialize?
- האם הקוד שלנו צריך לטפל ב-`auth_required` error או ב-`authenticate` method?
- מה קורה אם opencode דורש auth ואנחנו מתעלמים?

### C. Session Setup
- `NewSessionRequest` — מה השדות החובה? מה האופציונליים?
- `mcpServers: []` — האם זה תקין? מה השפעת המשתמשים?
- `additionalDirectories` — האם צריך להעביר?
- `NewSessionResponse` — מה השדות שמחזירים? `sessionId`, `models`, `modes`, `configOptions`. איפה אנחנו מתעלמים?
- האם `loadSession` תומך (D24)? מה מצריך?

### D. Prompt Turn
- מה ה-`PromptRequest` מצריך? כל ה-content types המתאימים?
- מה ה-`StopReason` ב-`PromptResponse` (`end_turn`, `cancelled`, etc)? איך אנחנו מטפלים בכל אחד?
- **המוקד:** `agent_message_chunk` vs `agent_thought_chunk` vs `user_message_chunk` — מה ההבדל, מה אנחנו מטפלים?
- `tool_call` updates — איך נראים? מה ה-fields? איך מציגים?
- `plan` updates — מה זה? איך לטפל?

### E. File System (clientCapabilities.fs)
- `fs.readTextFile` capability — מה דורש?
- `fs.writeTextFile` capability — מה דורש?
- ה-client-impl שלנו מספק handlers — האם ה-capabilities מוצהרות נכון?

### F. Permissions
- `requestPermission` flow — מה ה-`options` בקריאה?
- `outcome` types: `selected | cancelled`?
- ה-`optionId` — מה הקונבנציה? `allow_once`, `allow_always`, `reject_once`, `reject_always`?
- האם opencode מצפה לpermission לפני tool calls?

### G. Terminals (אופציונלי לMVP אבל בדוק)
- האם opencode דורש terminal capability?
- מה קורה אם אין?

### H. Session Modes + Slash Commands + Plans
- האם opencode שולח `availableCommandsUpdate`, `currentModeUpdate`, `planUpdate`?
- האם אנחנו צורכים? מה אבד אם לא?

### I. Cancellation
- `session/cancel` — איך עובד? איך מבטל באמצע prompt?
- האם ה-Promise של `prompt()` חוזר עם stopReason=cancelled, או נחתך?

### J. Transport (NDJSON)
- מה ה-spec של ה-transport? newlines, encoding?
- ה-`wsToStreams` שלנו + `ndJsonStream` ב-SDK — האם המיפוי נכון?

### K. Errors
- JSON-RPC error codes שאנחנו צריכים לטפל בהם
- מה קורה אם opencode מחזיר error באמצע session?

### L. Capabilities שלא ניצלנו
- `image` ב-promptCapabilities — אנחנו לא שולחים תמונות, OK
- `embeddedContext` — מה זה?
- `loadSession` — היכן זה ייכנס?
- `unstable_setSessionModel` — איך לקרוא? מתי? איזה types?

---

## 3. פורמט הפלט

קובץ: `docs/reviews/acp-conformance.md`

```markdown
# ACP Conformance Check

**Date:** 2026-05-16
**Range:** Slices 1-5 (commits db1a9f2..9b7c912)
**Reviewer:** Yolo (Sonnet 4-6)
**Spec version:** v1 (כפי שמוצג ב-agentclientprotocol.com, 2026-05-16)

## TL;DR
[3-5 שורות — האם ה-flow basic יעבוד? איפה האסונות?]

## A. Initialization
### מה ה-spec דורש
[ציטוט מהspec]
### מה אנחנו עושים
[file:line של הקוד שלנו]
### Verdict
- ✅ matches / ⚠️ partial / ❌ violates / 🟦 deliberate-skip

### Issues
[רק אם יש]

## B. Authentication
[אותו פורמט]

... (כל סעיף A-L)

---

## Summary Table

| תחום | סטטוס | חומרה | תיקון נדרש |
|------|--------|--------|-------------|
| Initialization | ❌ | 🔴 | clientCapabilities.fs חייב |
| Authentication | 🟦 | — | OAuth של opencode נשאר ב-CLI |
| ... | | | |

---

## Critical Findings (חייב לתקן לפני המשך)

[רשימה ממוספרת, file:line, ציטוט, תיקון מוצע]

## Important (לתקן לפני Slice 6)

[רשימה]

## Minor / Future

[רשימה]

---

## אישור או הפרכה של ההיפותזה של Tama

**ההיפותזה:** newSession תקוע כי `clientCapabilities: {}` ריקות → opencode acp לא יכול לקרוא AGENTS.md ב-cwd.

**ממצאך:** [מאמת / מפריך / לא ודאי]

**ראיות:** [ציטוטים מהspec + מהקוד]

---

## פתוחות לדיון עם Tama

[שאלות אדריכליות שאתה לא בטוח לגביהן]
```

---

## 4. הוראות פעולה

1. **קרא את ה-SDK schema first** — זה ה-source of truth הקנוני (`types.gen.d.ts`).
2. **קרא את ה-spec docs** דרך Webfetch — 14 URLs ברשימה. הסר את ה-`.md` extension אם יש בעיה.
3. **קרא את הקוד שלנו** — 7 קבצים קריטיים + 3 משניים.
4. **השווה systematically** — לכל תחום A-L: מה ה-spec דורש vs. מה אנחנו עושים.
5. **כתוב את הדוח** ב-`docs/reviews/acp-conformance.md` בעברית.
6. **אל תיגע בקבצי קוד** — לא ב-`packages/`, לא ב-`docs/agents/`. רק קובץ אחד: הדוח.
7. **בסוף:** commit אחד —
   ```
   git add docs/reviews/acp-conformance.md
   git commit -m "(review): ACP conformance check — Slices 1-5"
   ```

**Timeline:** 30-45 דקות. אם עברת שעה — דווח מה שיש לך.

**אל תפחד מ-Webfetch** — קרא את כל ה-URL החובה, אפילו אם זה איטי. עדיף 14 קריאות מדויקות מאשר תיאור גס.

**אל תיכנס לפרטי implementation של voice/UI/frontend** — זה לא הנושא. רק ACP.

בהצלחה.
