# Slice P1d — frontend cutover: AcpClient → ProviderSession

> **תאריך**: 2026-06-15
> **סטטוס**: 🔴 **NEEDS-REWORK** (אביגיל, 2026-06-16) — **לא ישים כמו שתוכנן**. HOLD לבדיקה+re-design. blockers (3🔴):
> 1. **ProviderSession הקנוני חסר methods**: `loadSession`/`newSession`(return config)/`setSessionConfigOption`/`setSessionModel`/`setSessionMode` — 8 call-sites של `#client` אין להם migration path. → דורש **הרחבת ה-contract** (tier-2 methods) **לפני** P1d.
> 2. **replay**: `user_message_chunk` (היסטוריית loadSession) ממופה ל-`raw`, לא bubble → user-bubbles נעלמים ב-replay.
> 3. **config UI**: `#captureSessionConfig` צורך `{configOptions,models,modes}` מ-newSession/loadSession; `start()` זורק את זה → config/model/mode UI נשבר.
> + 🟡: bubble `ToolContent` discriminant הוא `type:` מול canonical `kind:` — אי-אפשר פשוט למחוק את ה-mapper; permission.request הוא net-new (לא migration).
> **מסקנה**: P1d מצריך קודם **slice הרחבת ProviderSession** (loadSession/newSession-config/session-settings ל-contract+acp-adapter). נדון מחר.

> ~~**סטטוס מקורי**: DRAFT~~
> **Base**: `integration-vnext` (drive-coding, מ-`dev`)
> **Complexity**: ~8/10 (calev-heavy) — refactor של ה-state machine המרכזי של ה-frontend
> **depends_on**: `[]` (משתמש ב-`AcpProviderSession` מ-`provider-contract/acp` שכבר ב-main/git-dep)
> מקור: `provider-contract/docs/design/vnext-transport-launch.md` §5 + Explore P1d (mapping line-by-line)
> ⚠️ **לא להריץ אוטומטית בלילה בלי בדיקה אנושית** — slice גדול, regression risk גבוה (E2E).

---

## §1 — מטרה
ה-frontend עובר מצריכת `AcpClient` raw + מיפוי ACP-notifications מקומי ל-bubbles →
לצריכת ה-`ProviderSession`/`ProviderEvent` הקנוני (דרך `AcpProviderSession` מ-`provider-contract/acp`).
ה-מיפוי המקומי (~150 שורות) נמחק — `mapAcpNotification` כבר עושה אותו בתוך ה-adapter.

## §2 — Scope (מ-Explore §6)

### In scope
- `agent-session.svelte.ts`: `#client: AcpClient` → `#session: ProviderSession`.
- `#onSessionUpdate(SessionNotification)` → `#onProviderEvent(ProviderEvent)` (switch על `event.type`).
- **מחק**: `#handleToolCall`, `#handleToolCallUpdate`, `#mapToolContent`, `#mapLocations` (שורות ~928-1160).
- lifecycle: `createAcpClient` → `new AcpProviderSession({transport, cwd}).start(consumer)`.
- tests: mock `ProviderSession` במקום `AcpClient`.

### Out of scope
- `WsAcpTransport` — נשאר as-is (transport agnostic).
- bubble model shape — תואם; רק variant `"other"` (content) מסונן ע"י mapAcpNotification (UI כבר מטפל).
- UI components (12 קבצי bubbles) — אין שינוי מבני.

## §3 — Design (mapping line-by-line, Explore §9)

| כיום (ACP) | אחרי (ProviderSession) | שורה (agent-session.svelte.ts) |
|---|---|---|
| `createAcpClient(transport, #onSessionUpdate)` | `const s = new AcpProviderSession({ transport, cwd }); s.onEvent(#onProviderEvent); await s.start(consumer)` | 20, 398, 458, 585 |
| `#client: AcpClient \| null` | `#session: ProviderSession \| null` | 129 |
| `#onSessionUpdate(SessionNotification)` | `#onProviderEvent(ProviderEvent)` — switch על type | 1023-1073 |
| `#handleToolCall` / `#handleToolCallUpdate` | case `"tool_call"`: בנה/עדכן ToolBubble מ-`event` ישירות | 1077-1160 |
| `#mapToolContent(raw)` / `#mapLocations(raw)` | **מחק** — `event.content` / `event.locations` כבר ממופים | 928-979 |
| `#client.prompt(sessionId, text)` | `#session.sendPrompt(text)` | 522 |
| `#client.cancel(sessionId)` | `#session.cancel(turnId)` | 858 |
| `#client.close()` | `#session.stop()` | 913, 329, 1215 |
| `#client.listSessions()` | `#session.listSessions?.()` | 829 |

ProviderEvent types למיפוי: `tool_call` → ToolBubble; `message.delta` → appendChunk(message); `thinking.delta` → appendChunk(thought); `turn.end`/`turn.cancelled` → turnState; `permission.request` → permission UI; `error` → error bubble.

⚠️ **turn semantics** (Explore §10.2): `sendPrompt()` מחזיר מיד `{turnId, status:"running"}`; `turn.end` async דרך event. שונה מה-AgentSession הנוכחי שחוסם עד turn-end. התאם את ה-turnState (אולי אפשר להסיר את ה-msr-v2 tail-debounce workaround). אמת מול הטסטים הקיימים (turnstate.test).

⚠️ **consumer capabilities**: `start(consumer: ConsumerCapabilities)` — ספק `{ fs, terminal, permissions }` לפי מה ש-frontend תומך.

## §4 — Commits
0. החלף lifecycle: `#client`→`#session`, createAcpClient→AcpProviderSession+start+onEvent. typecheck.
1. החלף `#onSessionUpdate`→`#onProviderEvent` (switch), מחק handlers+mappers (928-1160). typecheck.
2. תקן prompt/cancel/stop/listSessions. typecheck.
3. עדכן tests (mock ProviderSession). `pnpm vitest run --project @drive-coding/frontend-v2` ירוק.
4. svelte-check + `pnpm build` (production!) ירוק.

## §5 — DoD
| # | בדיקה |
|---|------|
| 1 | svelte-check 0 errors; `pnpm build` (production vite) exit 0 |
| 2 | `agent-session.svelte.ts` משתמש ב-`AcpProviderSession`/`ProviderSession`; אין `createAcpClient`/`AcpClient` |
| 3 | `#onProviderEvent` מטפל בכל ה-ProviderEvent types הרלוונטיים; ה-mappers המקומיים נמחקו |
| 4 | bubbles עדיין מוצגים נכון (tool_call/message/thought) — אומת בטסט |
| 5 | `pnpm vitest run --project @drive-coding/frontend-v2` ירוק; mock ProviderSession |
| 6 | turn semantics: sendPrompt לא חוסם; turn.end דרך event; turnState נכון |
| 7 | **smoke (calev-heavy)**: הרצת ה-app, יצירת agent, prompt, תשובה מוצגת — ACP flow מלא |

## §6 — Risks
| סיכון | מיטיגציה |
|------|----------|
| regression E2E (scroll/animations/permissions/clicks) | calev-heavy smoke; אמת כל flow |
| turn semantics mismatch (blocking→async) | §3 הערה; אמת turnstate.test; אולי הסר tail-debounce |
| bubble "other" content נעלם | UI כבר מטפל (סינון ב-mapAcpNotification); cleanup בלבד |
| ProviderEvent type חסר handler | switch ממצה + `default` ל-raw/log |

## §7 — Escalation
- אם ה-state machine מתגלה מורכב משמעותית מ-Explore (turnState/replay/cancel edge-cases) → עצור, דווח, פצל.
- registry pattern (createRegistry במקום AcpProviderSession ישיר) — **לא** ב-P1d; P1d מניח instantiation ישיר. registry cutover = slice עתידי.
