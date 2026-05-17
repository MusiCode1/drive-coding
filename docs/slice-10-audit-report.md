# Slice 10 Audit Report

> ‏תאריך: 2026-05-17 · auditor: general sub-agent (yolo)
> ‏בדק: `docs/slice-10-fe-orchestrated-brief.md` @ commit `1c55ecd`
> ‏אימות מול: `packages/backend/src/**`, `node_modules/.pnpm/@agentclientprotocol+sdk@0.21.1`,
> ‏`node_modules/.pnpm/@google+genai@2.3.0`, `node_modules/.pnpm/@ai-sdk+google@3.0.75`,
> ‏`docs/slice-10-research.md`, `learnings.md`.

## TL;DR

‏מצאתי **5 critical**, **9 medium**, **8 minor** findings. ‏ה-brief תקין ארכיטקטונית
‏ועקבי עם ההכרעות הסגורות, ‏אבל ‏יש פערים ש-executor יכשל בהם בלי תיקון.

‏הקריטיים שמחייבים תיקון לפני implementation:
1. ‏שגיאת casing: `httpOptions.baseURL` ל-`@google/genai` — ‏ה-SDK ‏מצפה ‏ל-`baseUrl` ‏(`u` ‏קטנה). ‏STT יקרה ‏ל-Google ‏האמיתי ולא ל-proxy. ‏כל ה-STT יישבר ב-MVP.
2. ‏`(conn as any).loadSession / listSessions` ‏מיותר — ‏ב-SDK 0.21.1 ‏הם methods מוטיפסים ב-`ClientSideConnection`. ‏ה-brief העתיק קוד ‏ישן שהשתמש ב-`as any`.
3. ‏`fs.readTextFile/writeTextFile` ‏יוצהר false ב-brief — ‏אבל ב-`client-impl.ts` הנוכחי ‏הם **כן** ‏מוצהרים true ‏ו-opencode ‏אולי תלוי בהם. ‏אין אימות שopencode קורא לדיסק לבד ב-100% מהמקרים.
4. ‏crash listener ב-`agent-orchestrator.ts:61-81` תלוי ב-`AgentSession` שנמחק. ‏לא ‏מתואר ‏ב-brief איך crash flow ‏ימשיך לעבוד אחרי שAgentSession איננו.
5. ‏‏ה-brief מסתמך על Bun fetch ‏שיעבור דרך HTTPS_PROXY (OneCLI). ‏המידע ש-OneCLI מזריק key לפי host נכון, ‏אבל אין בדיקה בbrief ש-Bun fetch ‏‏אכן מכבד HTTPS_PROXY. ‏טעות תקבר את כל ה-proxy שקוף.

---

## Findings — Critical (חוסם תחילת ‏implementation)

### CRIT-1 — `@google/genai` ‏option ‏שגוי: ‏`baseURL` ‏במקום `baseUrl`

‏ה-brief ‏§6.4 (line 1135-1138):
```ts
export const googleGenAi = new GoogleGenAI({
  apiKey: "browser-placeholder",
  httpOptions: { baseURL: `${PROXY_BASE}/proxy/google` },  // ❌
})
```

‏אבל ה-SDK ‏מוגדר ‏ב-`node_modules/.pnpm/@google+genai@2.3.0/.../web/web.d.ts:5904`:
```ts
export declare interface HttpOptions {
    baseUrl?: string;  // ✅ lowercase 'u'
}
```

‏אומת ב-`web/index.mjs`: ‏`getBaseUrl(httpOptions, ...)` ‏בודק `httpOptions.baseUrl`.
‏עם `baseURL` (camelCase capital) ‏ה-SDK יתעלם ‏ויפנה ל-default
`https://generativelanguage.googleapis.com/` ‏ישירות מהדפדפן → ‏CORS error + 401.

**הצעה:** ‏לשנות ל-`baseUrl: "${PROXY_BASE}/proxy/google/"`. ‏שים לב גם ל-trailing slash —
‏ה-SDK ‏מצפה ש-`baseUrl` ייגמר ב-`/` ‏‏לפני שהוא מצרף את `apiVersion` ‏(`v1beta` default).

‏‏אזהרה משנית: ב-FE ‏`@ai-sdk/google` **‏כן** משתמש ב-`baseURL` (camelCase capital — ‏index.d.ts line 494),
‏אז `googleAi` ‏נכון. ‏זאת ‏סוגיה מבלבלת ובעלת סיכון גבוה לטעות נוספת — ‏ה-brief צריך
‏‏הערה מפורשת ‏‏שמדגישה ‏את ההבדל.

---

### CRIT-2 — ACP SDK 0.21.1 ‏מטפס `loadSession` ‏ו-`listSessions` כ-methods טבעיים

‏ה-brief ‏§6.2 (lines 1062-1068):
```ts
async loadSession(opts) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (conn as any).loadSession({...})
},
async listSessions() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (conn as any).listSessions({})
},
```

‏אבל ב-`@agentclientprotocol/sdk@0.21.1/dist/acp.d.ts:294,322`:
```ts
loadSession(params: schema.LoadSessionRequest): Promise<schema.LoadSessionResponse>;
listSessions(params: schema.ListSessionsRequest): Promise<schema.ListSessionsResponse>;
```

‏זה methods טבעיים על ClientSideConnection. ‏אין ‏צורך ‏ב-`as any`. ‏הקוד ‏הנוכחי ב-BE ‏(`acp-transport.ts:271,338`) ‏השתמש ב-`as any` ‏כי ‏SDK ‏גרסה קודמת לא טיפס אותם, ‏וה-brief העתיק את ה-pattern.

**הצעה:** ‏‏‏לקרוא ‏פשוט `conn.loadSession({...})`. ‏שמירה על ‏טייפ-בטיחות + ‏הסרת `eslint-disable`. ‏גם: ‏ב-`createAcpClient.loadSession` ‏הקריאה ‏‏לא מבדילה ‏בין `capabilities.loadSession === false` (CLI לא תומך) ‏לבין success — ‏יזרוק error code -32601. ‏יש לעטוף `try/catch` כמו ב-`listSessionsFromBridge:285`.

---

### CRIT-3 — Decision על `fs` capabilities שונה ‏מהקוד הקיים, ‏ללא ‏אימות שopencode עובד בלעדיהם

‏ה-brief ‏§1 (line 38) ‏מציין: ‏"fs.readTextFile/writeTextFile — ‏FE לא ‏מצהיר · opencode קורא לבד מהדיסק".

‏ה-brief ‏§6.2 (lines 1040): ‏`clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } }`.

‏ה-brief ‏§6.3 ‏client-impl ‏לא ‏‏מממש readTextFile/writeTextFile.

‏אבל ב-`packages/backend/src/acp/client-impl.ts:41-56` (‏הקוד הנוכחי): ‏**כן** מימש ‏readTextFile + writeTextFile, ‏וב-`acp-transport.ts:117`: ‏`fs: { readTextFile: true, writeTextFile: true }`.

‏אין ב-codebase ‏או ‏ב-research evidence ‏ש-opencode ‏עובד ‏נכון ‏עם fs caps=false. ‏ייתכן ‏שopencode קורא לדיסק לבד ‏ב-MVP (read/edit שלו), ‏אבל לא ‏ברור ‏אם ‏זה ‏‏‏מקרים ספציפיים ‏(לדוגמה: ‏‏editor-aware features או workflow features) ‏‏שדורשים את ה-host כ-mediator.

**הצעה:** ‏שתי אפשרויות:
- (א) ‏‏השאר fs caps=true ‏ו-port את `readTextFile`/`writeTextFile` ‏‏ל-FE עם ‏fetch ‏ל-endpoint חדש `POST /api/fs/read` ‏ו-`POST /api/fs/write`. ‏‏יוסיף ~60 שורות + permission concerns.
- (ב) ‏‏אם ‏אבי מאשר ‏‏fs caps=false, ‏הוסף ‏ל-DoD ‏smoke test ‏‏‏ספציפי ‏ב-Phase 2: ‏prompt ‏שמבקש מopencode לקרוא קובץ. ‏‏אם זה עובד — ‏סגור. ‏אם לא — ‏‏‏הbrief צריך לפתוח את ה-decision מחדש.

---

### CRIT-4 — Crash handler ‏ב-orchestrator לא מתואר במצב החדש

‏ב-`agent-orchestrator.ts:61-81`, ה-crash listener ‏המבוסס על `bridgeManager.onCrash(...)`:
```ts
const session = sessions.get(bridgeId)
if (session) {
  await session.shutdown().catch(() => {})
  sessions.delete(bridgeId)
}
```

‏אבל ב-Slice 10, `AgentSession` ‏נמחק ‏(brief §5 line 904: ‏"הסר ‏יצירת ACP transport, createAgentSession, ‏historyBuffer..."). ‏ה-`sessions` Map ‏‏לא יקיים יותר. ‏ה-brief ‏§5 line 910 ‏אומר: ‏"orchestrator עדיין מנהל crash listening — אם bridge מת, מסמן status=crashed עם crashReason ‏מ-stderr", ‏אבל לא מציין:

1. ‏איך orchestrator יודע לסגור את `feWs` ‏הסוגרת ‏(הצד הfront של ws-agent) — ‏לא ‏רק את ה-`bridgeWs` (שכבר נסגר אוטומטית כי הbridge מת)
2. ‏האם ‏`stderrGetters` Map ‏עדיין יוצר ויאוכלס ‏(brief line 892 כן מציין שכן — `stderrGetters.set`)
3. ‏מה ‏עושים עם ‏השלמת/דחיית prompts ‏שעדיין pending ‏(במצב החדש ‏אין AgentSession, ‏אז ‏prompt לא מסתיים בfailing fast)

**הצעה:** ‏‏הוסף ל-brief סעיף ‏מפורש "Crash handling במצב החדש" ‏עם flow מפורט: ‏orchestrator → ‏registry.update(status=crashed) → ‏close feWs ‏עם reason. ‏אופציה: ‏‏‏‏ws-agent handler ‏עוקב בעצמו ‏אחרי close של bridgeWs ‏(‏שהוא ‏‏עושה היום ‏ב-brief line 619).

---

### CRIT-5 — ‏‏הסתמכות לא מתועדת על HTTPS_PROXY של OneCLI דרך Bun fetch

‏ה-brief ‏§3.2 line 159: ‏"BE עצמו ‏רץ מאחורי OneCLI proxy ‏(HTTPS_PROXY env). ‏ה-fetch ‏החיצוני ‏עובר דרכו."

‏זה ‏נכון מבחינה ארכיטקטונית — ‏OneCLI ‏מזריק לפי host (לפי learnings 2026-05-14, 2026-05-16). **אבל:**

1. ‏אין ‏ב-brief ‏הנחיה תפעולית ‏שהexecutor יוודא: "BE ‏‏חייב לרוץ ‏עם `onecli run --agent voice-acp -- bun src/server.ts`". ‏אחרת ‏ה-fetch ‏ייצא ל-Google/ElevenLabs בלי api key → 401.
2. ‏‏‏Bun fetch ‏(`global.fetch` ‏ב-runtime של Bun) — ‏בגרסה הנוכחית (`bun-types@1.3.14`) **‏כן** ‏מכבד HTTPS_PROXY ‏‏‏אבל היסטורית היו gotchas. ‏‏ראוי לadd integration test בPhase 1 ‏שמוודא: ‏עם HTTPS_PROXY=invalid ‏ה-fetch ‏‏נכשל ‏(=‏הוכחה שהוא ‏עובר דרך HTTPS_PROXY).
3. ‏ה-flow של "FE ‏שולח placeholder header → ‏BE מעביר → OneCLI מחליף":
   - ‏אם FE ‏שולח `x-goog-api-key: browser-placeholder`, ‏BE מעביר as-is לupstream.
   - ‏OneCLI ‏‏אז ‏מחליף ‏‏‏ב-real key.
   - ‏לפי learnings 2026-05-16: ‏OneCLI ‏**מחליף ‏ערך קיים**. ‏זה ‏‏‏עובד. ✅
   - ‏‏אבל: ‏‏מה אם FE ‏לא שולח header בכלל? OneCLI ‏עדיין ‏מוסיף או ‏‏מתעלם? ‏לא אומת.
   - ‏‏הוסף ‏ל-brief ‏הנחיה לFE: "‏תמיד שלח header עם placeholder, ‏גם ל-Gemini ‏וגם ל-ElevenLabs, ‏גם דרך SDK ‏וגם דרך fetch ישיר".

**הצעה:** ‏הוסף סעיף "Operational requirements" ‏ב-§7 Phase 1: "BE ‏‏חייב ‏לרוץ ‏מאחורי OneCLI agent `voice-acp`. ‏‏בodd עוטף הדorchestration commands ב-tmux: `onecli run --agent voice-acp -- bun src/server.ts`".

---

## Findings — Medium

### MED-1 — `existingSessionId` API contract לא מוגדר במצב החדש

‏ה-brief ‏§3.6 line 207: ‏`POST /api/agents { cwd, cliKind, existingSessionId? }`.
‏§3.6 line 221: ‏"אם FE שולח existingSessionId — BE בודק registry ‏ומחזיר agent קיים. ‏פשוט יותר ל-BE."
‏§14.1: ‏ממליץ ‏(א) — ‏BE keeps dedup.

‏אבל: ‏אם FE שלח `existingSessionId` ‏ו-BE ‏לא ‏מצא duplicate, ‏BE ‏עדיין צריך לעשות spawn. ‏ה-flow ‏אחר כך:
- ‏FE ‏מקבל `{ agentId, wsUrl }` ‏+ ‏ידיעה ש-existingSessionId ‏לא ‏‏היה duplicate (=‏לא ‏‏עם session attached יותר).
- ‏FE עושה loadSession ‏(לא newSession) ‏עם ‏ה-existingSessionId.

‏אבל ‏הbrief ‏‏לא ‏‏מציין שCorpse מהBE ‏מחזיר ‏את ה-existingSessionId חזרה ‏(או existingSessionId-was-ignored). ‏ה-FE ‏רק יודע ‏לעשות loadSession ‏אם זוכר שביקש קודם. ‏‏‏‏גם פלוס ‏אם dedup הצליח (BE מחזיר agent ‏עם acpSessionId כבר מוגדר) ‏‏ה-FE ‏לא צריך לעשות session/load פעם נוספת. ‏BE צריך להחזיר ‏רמז.

**הצעה:** ‏BE מחזיר ‏‏`{ agentId, wsUrl, bridgePort, status: "spawning" | "ready", acpSessionId?: string }`. ‏אם `status === "ready"` ‏אז ‏FE ‏מדלג ‏על ‏handshake. ‏אחרת ‏FE ‏‏עושה ‏initialize + session/{new|load} ‏לפי `input.existingSessionId`.

### MED-2 — ‏stdio-to-ws `--persist --grace-period -1` ‏גורם ל-bridge leak

‏ב-`cli-config.ts:62-64`:
```ts
"--persist", "--grace-period", "-1",
```

‏`--persist` ‏שומר את ה-bridge ‏בחיים ‏אחרי שWS נסגר. ‏`--grace-period -1` ‏= ‏infinite grace.

‏ה-effect ‏‏ב-MVP הנוכחי: ‏‏FE refresh → ‏feWs ‏נסגר → ‏bridgeWs ‏נסגר ‏(brief §5 line 631) → ‏stdio-to-ws ‏‏‏‏מחכה infinite ‏ל-reconnect → ‏ה-subprocess ‏(opencode) ‏ממשיך לרוץ. ‏‏FE ‏חוזר → ‏POST /api/agents ‏‏יוצר agent חדש → ‏stdio-to-ws חדש → opencode חדש. ‏ה-bridge הישן ‏לא ‏נהרג.

**‏זה ‏לא ‏‏בעיה חדשה ‏של Slice 10**, ‏אבל ‏ב-FE-orchestrated model זה ‏בולט יותר ‏כי ‏אין יותר state ב-BE ‏שמחבר בין refresh.

**הצעה:** ‏‏שקול ‏`--grace-period 60` ‏(60s ‏לreconnect) ‏או ‏‏הוסף cleanup task ‏‏שmurdersjobs את bridges ‏ש-WS שלהם לא ‏פעיל > 5min. ‏לא חוסם MVP ‏אבל ‏שווה ‏לתעד.

### MED-3 — ‏Pseudocode ‏ב-§5 (ws-agent): ‏טאוטולוגיה ‏‏בrebroadcast

‏Brief lines 613-617:
```ts
bridgeWs.on("message", (data) => {
  try {
    feWs.send(typeof data === "string" ? data : data)  // ❌ both branches identical
  } catch { /* ws closing */ }
})
```

‏זה nonsense — ‏שני הענפים זהים. ‏ההתכוונות הייתה כנראה ל-`data instanceof Buffer ? data.toString() : data`. ‏‏בכל ‏case, ‏Bun's ServerWebSocket.send ‏מקבל `string | BufferSource`, ‏אז אפשר לפשט: ‏`feWs.send(data)`.

‏גם ‏Phase 5 (line 845-848) — ‏אותה טעות.

### MED-4 — ‏Handshake timeout ‏אבד ‏ב-FE

‏ב-`acp-transport.ts:62-70` ‏היום: ‏HANDSHAKE_TIMEOUT_MS = 45_000, ‏וגם 10s ‏מספציפית ‏ל-stdio-to-ws connected (line 79).

‏ה-brief ‏§6.2 lines 1015-1025:
```ts
await new Promise<void>((resolve) => {
  const onMsg = (ev: MessageEvent) => {
    const text = typeof ev.data === "string" ? ev.data : ""
    if (text.includes('"type":"connected"')) {...}
  }
  ws.addEventListener("message", onMsg)
})
```

‏‏אין timeout. ‏‏אם stdio-to-ws ‏לא ‏שולח `connected` (לדוגמה ‏ה-binary לא רץ, ‏או ‏port ‏מבוטה), ‏FE ‏יתלה ‏לנצח.

**הצעה:** ‏הוסף ‏Promise.race ‏עם 10s timeout. ‏אם expires, ‏close ws + ‏throw error.

### MED-5 — ‏Base64 ‏גדול ב-STT: `btoa(String.fromCharCode(...))` ‏יקרוס

‏Brief §6.5 line 1163:
```ts
const base64 = btoa(String.fromCharCode(...audioBytes))
```

‏‏בopposite ‏ל-audio > ~100KB, ‏ה-spread operator ‏‏ב-`String.fromCharCode(...audioBytes)` ‏זורק "Maximum call stack size exceeded" ב-Chrome. ‏‏Hebrew voice notes ‏‏לרוב 30-300KB → ‏גבוליtus.

**הצעה:** ‏השתמש ‏ב-chunked conversion:
```ts
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
```

### MED-6 — `MediaSource` ‏sourceopen race

‏Brief §4 lines 463-469:
```ts
audio.src = URL.createObjectURL(mediaSource)
const seg = {...}
this.segments.set(segmentId, seg)
await new Promise<void>((resolve) => {
  mediaSource.addEventListener("sourceopen", () => {...}, { once: true })
})
```

‏‏`sourceopen` ‏‏יורה רק ‏‏‏אחרי ‏ש-audio element ‏מצרף את MediaSource — ‏זה async (next microtask, ‏לפי spec). ‏ב-Chrome זה ‏עובד ‏ב-99% מהמקרים ‏כי ‏‏‏ה-listener מתווסף ‏‏‏סינכרונית ‏לפני שהattach קורה. ‏אבל ‏אם ‏ה-CPU עמוס ‏(או ‏ב-tests עם happy-dom), ‏ייתכן ‏‏סיכון.

**הצעה:** ‏הוסף timeout ל-Promise (5s) ‏‏עם error מפורש. ‏‏או ‏‏‏בדוק ‏`mediaSource.readyState === "open"` ‏לפני ‏addEventListener.

### MED-7 — `response.body.tee()` ‏ב-cacheStreamInBackground ‏יבעיר memory ‏אם FE ‏מתנתק

‏Brief §5 lines 727-751: ‏ה-cache stream buffer ‏הוא in-memory ‏‏‏`chunks: Uint8Array[]`. ‏‏אם FE ‏‏מנתק את ה-fetch ‏‏באמצע (jump-to-message), ‏ה-`toClient` stream ‏נסגר אבל ‏ה-`toCache` ‏ממשיך לקרוא ‏את כל ה-bytes ‏מ-upstream.

‏‏יתרון: ‏ה-cache ‏עדיין נשמר ‏(שווה ‏לhit עתידי).
‏חיסרון: ‏‏‏לbridge חיבור מהיר → ‏TTS ‏גדול ‏(5 דקות שיחה = ~5MB) ‏בזכרון לפני שנכתב.

‏גם: ‏אם upstream נכשל ‏באמצע (network error), ‏‏ה-catch ‏‏מתעלם ‏ולא ‏מנקה — ‏OK.

‏‏אבל: ‏מה אם ‏FE עושה fetch ‏-then-abort ‏בלולאה ‏(user מקפיץ הרבה)? ‏ייתכן ‏הצטברות של multiple תהליכים ברקע. ‏‏ב-MVP זה ‏‏‏סביר ‏אבל ‏יש סיכון.

**הצעה:** ‏הוסף ‏ל-cacheStreamInBackground ‏הגבלת ‏גודל ‏(50MB skip cache) + ‏‏הוסף concurrent cache writes limit (queue).

### MED-8 — ‏Multi-tab: ‏FE 1 + FE 2 ‏‏שותפים על אותו agent → ‏ACP state ‏‏מתנגש

‏Brief §1 line 42: "Multi-tab — לא נתמך פעיל. cache הופך אותו ל-tolerable".

‏אבל ב-Slice 10 ‏יותר חמור: ‏שני tabs ‏פותחים ‏WS ‏אחר ל-`/ws/agent/:id` → ‏ws-agent ‏‏פותח **שני** ‏bridgeWs ‏ל-stdio-to-ws ‏(‏line 598 ‏ב-brief). ‏‏זה ‏יוצר ‏שתי ‏ACP sessions ‏‏סינכרוניות ‏‏על אותו subprocess. ‏‏stdio-to-ws ‏לפי דוקומנטציה ‏מאפשר ‏multiple clients (broadcast), ‏אבל ACP ‏הוא ‏stateful — ‏‏שתי קריאות ל-initialize יקרסו ‏או יוצרו ‏‏שתי sessions.

‏‏‏ב-MVP הנוכחי (Slice 9), ‏BE עושה את handshake פעם אחת ויחיד. ‏ב-Slice 10, ‏‏FE עושה handshake — ‏‏שני tabs ‏‏=‏ ‏שתי הtshakes ‏על אותו bridge. ‏הראשונה ‏‏‏מצליחה ‏(opencode מקבל initialize), ‏‏‏השנייה ‏‏מקבלת error / שגיאת state.

**הצעה:** ‏לבחור גישה:
- (א) ‏BE ws-agent ‏מאלץ "one feWs per agentId" — ‏ws-agent רואה ‏feWs ‏שני ל-agentId קיים, ‏‏סוגר את הקודם או דוחה השני (close 1008 "agent in use").
- (ב) ‏השאר ‏‏open ‏ותעד "second tab will see undefined behavior".

‏‏‏המלצה: ‏(א). ‏‏‏בurg ב-brief.

### MED-9 — ‏FE prompt ‏לפני session-attached: ‏race window

‏Brief §3.6 flow:
1. ‏POST /api/agents → ‏{ agentId, wsUrl }
2. ‏WS connect → connected frame → 1500ms warmup → ‏initialize → ‏newSession → ‏sessionId
3. ‏POST /api/agents/:id/session-attached { sessionId } → ‏status=ready

‏מה ‏אם ‏‏FE ‏מתחיל לשלוח `session/prompt` ‏‏ישירות ‏‏אחרי step 2 ‏‏לפני ‏‏שsession-attached הסתיים? ‏‏ה-prompt יעבוד ‏‏(הbridge מוכן, ‏‏ACP session קיים) ‏אבל ‏BE ‏‏עדיין במצב "spawning" ‏ב-registry. ‏GET /api/agents יחזיר ‏status שגוי. ‏ה-projectsRegistry ‏לא ‏‏מעודכן. ‏אם ‏‏יש crash ‏באמצע, ‏stderr ‏עדיין נקלט ‏אבל cleanup ‏לא יודע שכבר ‏יש sessionId.

**הצעה:** ‏BE side: ‏לcompare-and-set status, ‏רק "ready" אם status שגוי לא ‏מוגדר. ‏FE side: ‏await POST `/api/agents/:id/session-attached` ‏לפני ‏‏‏שמותר לשלוח prompt. ‏הוסף ל-DoD ב-Phase 2.

---

## Findings — Minor (consistency / polish)

### MIN-1 — ‏מספרי שורות לא עקביים בין סעיפים

‏§8 line 1437: "BE shrinks ‏ב-~1200 שורות impl + ~600 שורות tests"
‏§12 line 1531: "**-1700 impl, -800 tests**"
‏§13 line 1563 (‏item 10): "**יותר — ~1700 שורות impl + 800 tests**"

‏§13 ‏‏טוען שהפער תוקן, ‏אבל ‏§8 ‏עוד עם המספר הישן.

### MIN-2 — DoD §8 line 1438: ‏"FE ‏מכיל ‏~800 שורות" ‏לעומת §12: ‏"+900-1100 impl, +250 tests"

‏גם פער.

### MIN-3 — `/ws/agent/:id` ‏מופיע **פעמיים** ‏ב-brief

‏Lines 587-636 ו-lines 820-868 — ‏אותו ‏code block ‏מ-`createAgentWsHandler`. ‏אחד מהם עודף.

### MIN-4 — Pathparam ‏‏inconsistency: `:agentId` vs `:id`

‏§3.4 line 185: `/api/agents/:id/session-attached`
‏§3.6 line 215: `/api/agents/:agentId/session-attached`
‏§5 line 802: `c.req.param("id")`

‏‏פשוט להחליט על אחד. ‏מומלץ `:id` ‏‏לעקביות עם DELETE `/api/agents/:id`.

### MIN-4 — comments ‏ישנים ‏ב-stores §4

‏Lines 244-246:
```ts
├── translate-client.ts            # NEW — /api/translate wrapper with abort
├── tts-client.ts                  # NEW — /api/tts streaming wrapper
├── narrate-client.ts              # NEW — /api/narrate wrapper
├── stt-client.ts                  # NEW — /api/stt wrapper
```

‏‏אבל ‏§6.5-6.8 ‏שולחים ‏ל-`/proxy/google` ‏ו-`/proxy/elevenlabs` ‏(לא `/api/translate` ‏וכו'). ‏ה-comments ‏בסיווג שגוי.

### MIN-5 — ‏TTS retry policy ‏לא ‏מוגדר

‏ה-brief ‏מוצא אופציה לroaming מ-`mp3 chunked fail` (network glitch באמצע streaming). ‏אין mention ‏ל-retry או ‏fallback. ‏‏הסבר ‏ל-FE ‏‏‏‏מה ‏לעשות ‏עם partial MP3 (errored MediaSource) — ‏skip ‏segment? ‏שמירת כתובית? ‏שווה paragraph.

### MIN-6 — ‏‏‏ws-to-streams ‏ב-FE: ‏encode→decode round-trip

‏Brief §6.1 lines 953-971: ‏receives ‏`ev.data` כstring ‏‏(אם הוא string), ‏‏אחרת decode ל-text. ‏‏אז ‏re-encode ל-Uint8Array עם TextEncoder.

‏זה ‏מיותר ‏אם ‏‏‏ev.data ‏הוא ‏‏Blob/ArrayBuffer ‏(זה ‏המקרה ‏בדפדפן ‏‏לבסיס ב-default). ‏אפשר להוסיף `ws.binaryType = "arraybuffer"` ‏ו-לcastr ישירות `new Uint8Array(ev.data)` ‏עבור ‏binary frames.

‏פגם תפקודי ‏מינורי — ‏יעבוד, ‏סתם CPU.

### MIN-7 — ‏ACP `auth_required` ‏טיפול ‏אבד ‏ב-FE

‏ב-`acp-transport.ts:148-156` (קיים): ‏מזהה ‏ACP error code -32000 ‏עם ‏`data.code === "auth_required"` ‏‏ומסיים ‏ב-error מסומן. ‏ה-brief ‏לא mention ‏איך ‏FE ‏יטפל ‏באוטו required (לדוגמה, ‏Claude שצריך login).

**הצעה:** ‏הוסף ‏‏ל-§6.2 ‏createAcpClient.initialize ‏catch: ‏אם err.data.code === "auth_required", ‏זרוק ‏error ‏מסומן ‏ש-FE UI יציג ‏‏"CLI דורש login: ‏הפעל ‏‏ב-shell `cli auth login`".

### MIN-8 — ‏§4 module list: ‏‏voice/playlist.ts ‏מוזכר ‏אבל ‏‏‏ב-§6 (implementation sketch) ‏אין section ייחודי לו

‏Module name appears ‏ב-line 240 + §7 line 1380. ‏‏ב-Implementation Sketch §6 ‏אין subsection 6.x ‏שמראה ‏API. ‏‏בעיה minor — ‏‏executor ‏יוכל לפענח מ-§4 type definitions, ‏אבל ‏עדיף ‏‏detail.

---

## Flows traced — sanity checks

| Flow | Status | Findings |
|------|--------|----------|
| Create new agent + first prompt | ⚠️ ‏‏gaps | MED-9 (race FE prompt לפני session-attached) |
| Load existing session | ⚠️ ‏‏gaps | MED-1 (existingSessionId contract), CRIT-2 (loadSession typing) |
| User cancels mid-prompt | ✅ OK | AbortController flow מוגדר ‏ב-§4 prefetch |
| Jump to message ‏באמצע thought TTS | ✅ OK | §4 player.onJump cancels pending > newIndex |
| Bridge crashes ‏לפני session-attached | ❌ ‏‏gap | CRIT-4 — FE ‏‏‏‏לא יודע מה לעשות אם crash ‏לפני שsession-attached הצליח |
| Bridge crashes ‏באמצע prompt | ⚠️ partial | crash → ‏close(1011) ‏ל-feWs → ‏FE polls /api/agents/:id ‏(§3.6 line 225). ‏‏אבל ‏אם ‏ה-prompt ‏הוא ‏Promise pending ‏ב-SDK, ‏האם ‏הוא rejects? ‏SDK ‏‏אמור ‏להציע error דרך stream close ‏‏אבל ‏לא ‏נבדק |
| FE refresh tab ‏באמצע playback | ⚠️ partial | localStorage state persistence ‏מציל ‏את position ‏אבל ‏MED-2 (bridge leak) ‏יוצר agent חדש לצד הישן |
| Two tabs ‏פותחים ‏אותה agent | ❌ gap | MED-8 — ‏ACP state ‏מתנגש |
| Cache hit לקריאה streaming (TTS) | ✅ OK | ‏‏cached body ‏מוחזר ‏‏מהdisk כ-Uint8Array, ‏FE קורא דרך ‏response.body.getReader() — ‏‏עובד. ‏MediaSource ‏יקבל ‏MP3 שלם בbatch אחד ‏(לא ‏פגם — ‏עדיין fast) |
| OneCLI gateway ‏לא ‏זמין (502) | ⚠️ partial | proxy יחזיר 502 ל-FE. ‏FE לא מטפל ‏(error handling ‏חסר ב-translate-client/tts-client) |
| Translation API timeout ‏באמצע prefetch | ✅ OK | §6.6 ‏עם TRANSLATE_TIMEOUT_MS = 2500ms, ‏‏fall to TS ‏fallback |
| Narration empty response | ✅ OK | §6.8 ‏‏fallback ‏ל-tool.title |
| Multiple TTS jobs prefetch ‏בו-זמנית עם identical text | ⚠️ ‏gap | ‏שני fetches עם אותו body → ‏שני cache misses → ‏שני upstream calls. ‏‏לא ‏פגם פונקציונלי ‏(שניהם ‏יחזירו זהה) ‏אבל ‏בזבוז quota |

---

## Library / runtime assumptions verified

| Assumption | Status | Evidence |
|------------|--------|----------|
| `@agentclientprotocol/sdk@0.21.1` runs in browser (Web Standards only) | ✅ confirmed | research §1; ‏אומת — ‏אין `node:*` ב-stream.js / acp.js |
| `ClientSideConnection.loadSession` ‏מוטיפס בSDK | ✅ confirmed | `acp.d.ts:294` — **CRIT-2** |
| `ClientSideConnection.listSessions` ‏מוטיפס בSDK | ✅ confirmed | `acp.d.ts:322` — **CRIT-2** |
| `@google/genai` ‏יש web build | ✅ confirmed | `package.json exports["./""].browser` → `dist/web/index.mjs` |
| `@google/genai` ‏מקבל `httpOptions.baseUrl` | ✅ confirmed | `web.d.ts:5904` — **‏שגיאת casing ב-brief, CRIT-1** |
| `@ai-sdk/google` ‏מקבל `baseURL` | ✅ confirmed | `dist/index.d.ts:494` — ‏‏‏OK ב-brief |
| `@ai-sdk/google` baseURL ‏‏מועבר ‏לכל ה-paths | ✅ confirmed | `dist/index.js:1522,1701,2640,2899` — ‏כל ‏ה-URL ‏‏‏מורכבים ‏עם `${config.baseURL}` |
| `@ai-sdk/elevenlabs` ‏לא תומך streaming | ✅ confirmed (research §4) | `/v1/text-to-speech/{id}` ‏(לא `/stream`); ‏פתרון: ‏fetch ישיר |
| `@ai-sdk/elevenlabs` ‏מעביר abortSignal לfetch | ✅ confirmed | research §5 |
| Bun ServerWebSocket.send ‏‏מקבל Buffer | ✅ confirmed | `bun-types@1.3.14`: `send(data: string \| BufferSource)`; `Buffer` ‏הוא `BufferSource` ‏‏(Uint8Array compatible) |
| Bun fetch `response.body.tee()` ‏‏עובד עם streaming response | ✅ confirmed (standard Web Streams) | ‏ReadableStream API; ‏Bun ‏‏מימש ‏מ-v1.0+ |
| Bun fetch ‏מכבד HTTPS_PROXY | ⚠️ ‏unverified | ‏סבירות גבוהה אבל לא בדוק explicit ‏ב-codebase — **CRIT-5** |
| MediaSource ‏ב-Chrome עם audio/mpeg | ✅ confirmed | ‏MediaSource Extensions; ‏MIME `audio/mpeg` ‏‏נתמך |
| stdio-to-ws ‏‏שולח `connected`, `heartbeat`, `disconnected`, `error` | ✅ confirmed | `ws-streams.ts:37` ‏ב-codebase ‏הקיים |
| `--persist --grace-period -1` ‏שומר bridge ‏לnever | ✅ confirmed | stdio-to-ws docs; **MED-2** |
| OneCLI ‏מחליף API key headers לפי host | ✅ confirmed | learnings 2026-05-14, 2026-05-16 |
| `recordingsStore.save({bytes, mimeType})` חתימה | ✅ confirmed | brief §13 item 12 |
| ACP loadSession ‏פולט sessionUpdate notifications ‏בdduring | ✅ confirmed | `acp-transport.ts:328-348` ‏ב-codebase: `onHistoryUpdate` callback מקבל notifications במהלך loadSession |
| ACP `auth_required` error code -32000 ‏עם data.code | ✅ confirmed | `acp-transport.ts:147-156` |

---

## ‏‏Open questions ‏ל-Avi

1. **fs caps decision (CRIT-3):** ‏האם ‏אומת ש-opencode ‏עובד ‏עם `fs.readTextFile: false`? ‏אם לא — ‏שתי אופציות (port ‏ל-FE / השארה ב-BE). ‏המלצה: ‏אם ‏אבי ‏זוכר ‏fl test ‏ידני, ‏לציין. ‏אחרת — ‏בדיקה ‏‏מהירה ‏ב-Phase 2 ‏עם prompt "read README.md".

2. **multi-tab strategy (MED-8):** ‏האם ‏לעצור ‏‏את ה-second tab ‏ב-WS upgrade (close 1008 "agent in use") ‏או ‏לאפשר ‏עם warning? ‏ה-brief ‏אומר ‏"tolerable" ‏אבל ‏ב-Slice 10 ‏זה ‏‏‏מסוכן יותר ‏(ACP state collision).

3. **existingSessionId in response (MED-1):** ‏האם ‏‏ה-POST /api/agents ‏צריך להחזיר `{ status: "spawning" | "ready", acpSessionId? }` כדי שFE ‏‏ידע ‏אם ‏לדלג ‏על ‏‏handshake (dedup)? ‏אני ‏ממליץ כן.

4. **server_event channel (§14.2):** ‏ה-brief ‏כבר ‏השאיר ‏את זה ‏פתוח. ‏אני ‏מסכים עם ‏אבי שגישה (ב) — ‏polling — ‏‏OK ‏ל-MVP. ‏אבל ‏MED-3/MED-4 מוסיפים ש-FE צריך ‏fallback ל-error מ-`close(1011)` ‏event שמופיע ‏על ה-WS, ‏‏שיתחיל את הpolling.

5. **‏TTS error policy (MIN-5):** ‏‏MediaSource ‏error באמצע playback — ‏‏skip segment ‏ועבור ‏‏לbubble הבא? ‏או ‏stop playback בכלל? ‏‏‏ה-brief לא ‏מציין.

---

## ‏Recommendations

‏1. **Pre-implementation fixes (חובה ‏לפני להעביר ל-executor):**
   - ‏CRIT-1: ‏תקן `baseURL` → `baseUrl` ב-`@google/genai` ‏ב-§6.4.
   - ‏CRIT-2: ‏הסר `as any` ‏מ-`loadSession`/`listSessions` קריאות ב-§6.2.
   - ‏CRIT-3: ‏‏החלט ‏fs caps strategy ‏(או ‏הוסף DoD smoke test).
   - ‏CRIT-4: ‏הוסף paragraph ‏על crash handling במצב החדש (5-10 שורות) ‏ב-§5.
   - ‏CRIT-5: ‏הוסף ‏Operational requirements ‏(`onecli run --agent voice-acp -- ...`) ‏ב-§7 Phase 1 + ‏integration test לוודא HTTPS_PROXY עובד.

‏2. **Medium fixes (תקן ב-Phase מתאים, ‏לא חוסם):**
   - ‏MED-1 (existingSessionId): ‏‏לחדד contract ב-§3.4 ‏לפני Phase 1.
   - ‏MED-2 (bridge leak): ‏הוסף ‏TODO comment, ‏‏לא חוסם MVP.
   - ‏MED-3 (typo בpseudocode): ‏‏לתקן ב-§5.
   - ‏MED-4 (handshake timeout): ‏‏‏‏‏הוסף timeout ‏ב-§6.2.
   - ‏MED-5 (base64): ‏בדל ‏ב-§6.5 - מקנן 1-2 שורות.
   - ‏MED-8 (multi-tab): ‏החלטה ‏ב-§3.1 ‏ws-agent.
   - ‏MED-9 (race): ‏ב-DoD Phase 2.

‏3. **Minor — ‏עדכן ‏‏ב-Phase 4 polish ‏או ‏בסקירת brief ‏הסופית:**
   - ‏‏מספרי שורות עקביים (MIN-1, MIN-2)
   - ‏הסר duplicate `/ws/agent/:id` ‏ב-§5 (MIN-3)
   - ‏Path param `:id` ‏אחיד (MIN-4)

‏4. **בדיקות תוספת ‏שאני ממליץ ‏ב-Phase 1 integration tests:**
   - `curl -x localhost:proxyport /proxy/google/v1beta/models/.../generateContent` ‏עם HTTPS_PROXY=onecli ‏מצליח — מאמת CRIT-5.
   - `curl ... | sha256` ‏‏זהה ‏בקריאה 2 → ‏אומת cache hit.
   - WS pipe test ‏‏‏‏עם `connected` + JSON-RPC frame בו זמנית — ‏‏בידוד.

‏5. **‏אזהרה ל-executor (להוסיף לprompt):**
   > ‏ה-brief ‏‏מערבב ‏בין שתי SDKs ‏ל-Google:
   > - `@ai-sdk/google` ‏‏(לtext) — ‏option ‏`baseURL` (capital URL).
   > - `@google/genai` ‏(ל-multimodal/STT) — ‏option ‏`httpOptions.baseUrl` (lowercase u).
   > ‏‏לא ‏לבלבל!

---

‏סוף דוח. ‏זמן: ~50 דקות.
