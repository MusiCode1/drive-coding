# Slice CUT-3b-iii-1 — connectInProcess (claude in-process → ProviderConnection) — בריף

> **תאריך**: 2026-06-28 · **סטטוס**: הושלם (calev GO 6/6, 0 findings) · **branch**: slice/cutover-migration
> **Complexity**: 8/10 (verifier: light + תשומת-לב למודל-החיבור) · **depends_on**: [CUT-3b-i] (הפרימיטיב; ii הוא BE-rewire שלא נצרך כאן) · **Base**: `slice/cutover-migration` @ `4ca8d09`
> **batch-mode**: נכתב יחד עם iii-2/FE-norm/feature לפני אימות. **לא ממזגים.**

---

## §0 — context

ה-in-process host (`providers/claude/in-process-host.ts`) היום **self-driving**: מחבר **`clientApp.connect(agentApp)`**
(in-process-host.ts:239) in-memory, לוכד `AgentContext` דרך `agentApp.onConnect`, ומחזיק clientApp פנימי שמניע
(start/newSession/prompt). ל-Model 2 (ה-FE הוא ה-ACP client) צריך לחשוף את צד-הagent **כ-stream** שה-BE מגשר ל-WS.
`acp.d.ts:565` מאשר overload: `agentApp.connect(stream: Stream)`. iii-1 משנה את **שני הצדדים**: **אין clientApp פנימי**;
ה-agentApp מתחבר ל-`stream` (לא ל-clientApp).

iii-1 בונה **`connectInProcess(opts) → ProviderConnection`** — אותה צורת פרימיטיב כמו `connectSpawn`, אבל
מתחת מארח את ClaudeAcpAgent in-process ומחבר אותו על stream. **additive — לא live-routed** (iii-2 מנתב).

## §1 — חוזה-API (מה ש-iii-2/FE-norm מסתמכים עליו)

```ts
// provider/src/providers/claude/connect-in-process.ts → מיוצא דרך @drive-coding/provider/connection
export function connectInProcess(opts: ConnectOpts): Promise<ProviderConnection>
// ProviderConnection זהה ל-connectSpawn: { wire{onLine,write}, capabilities, onFrame, turn, onCrash, close, ext?, pid }
// הבדלים: capabilities = claude (capabilities.ts) + extensions; ext handled IN-WIRE (agentApp.onRequest "_drive/*"); pid = claude child תחת ה-SDK
```

## §2 — Scope

| כן | לא |
|---|---|
| stream-adapter: `Stream` (acp-sdk-v1, **AnyMessage objects**) ↔ wire (string onLine/write) עם תרגום stringify/parse | live routing (iii-2) |
| **modelOverride**: `connectInProcess` מחווט `ConnectOpts.modelOverride` ל-session-creation של ה-host (SDK query model option / `_meta.claudeCode.options.model`) — אחרת בורר-המודל של claude in-process no-op | — |
| rework host: `agentApp.connect(stream)` במקום in-memory clientApp; שמור ext handlers + **capability mapping (BE-side, mapClaudeCapabilities — לא frame-injection)** | FE (FE-normalization) |
| `connectInProcess` → ProviderConnection (wire=stream, onFrame=tap, turn=derive, capabilities=claude+ext, pid, onCrash) | מחיקת in-process-host self-driving (השאר ל-live-tests אם צריך, או הסב) |
| export דרך `./connection`; tests (fake stream + live harness) | features (feature slice) |

## §3 — מימוש

- **⚠️ צורת ה-`Stream` (🟡 avigail — load-bearing)**: ה-`Stream` של sdk@1.0 הוא `{ writable: WritableStream<AnyMessage>, readable: ReadableStream<AnyMessage> }` (stream.d.ts:10-19) — Web Streams של **אובייקטים מפוענחים** (AnyMessage), **לא שורות ndjson**. אבל ה-`ProviderConnection.wire` הוא string-based (`onLine(line)`/`write(line)`, כמו connectSpawn). לכן ה-stream-adapter חייב **שכבת-תרגום `AnyMessage`↔`string`** בגבול: `write(line)` → `JSON.parse` → push ל-writable; readable של AnyMessage → `JSON.stringify` → `onLine(line)`. (`ndJsonStream` ממיר `Uint8Array`↔`AnyMessage` — לא string; אז בנה Stream ידני עם stringify/parse, או ndJsonStream + TextEncoder/Decoder.)
- **stream-adapter** (`connection/stream-bridge.ts`): בונה `Stream` ({readable,writable} של AnyMessage) ששני קצותיו: (א) `agentApp.connect(stream)`; (ב) BE-side string `{ onLine(cb), write(line) }` עם התרגום למעלה.
- **rework**: `connectInProcess` יוצר agentApp (כמו ה-host הקיים — ClaudeAcpAgent + ext handlers `_drive/*`), אבל `agentApp.connect(streamBridge.agentEnd)` במקום `clientApp.connect(agentApp)`. **אין clientApp פנימי** — ה-FE מניע.
- **onFrame/turn**: tap על התרגום — ב-`onLine`/`write` (שם ה-string זמין) → `decodeWireLine(line)` → WireFrame; turn-tracker על 'in'. (לא על אובייקטי-AnyMessage הגולמיים.)
- **capabilities (🟡 avigail — תיקון framing)**: **אין** capability-frame interception לתוך ה-initialize. ה-caps זורמים דרך `ProviderConnection.capabilities` (BE-side): `mapClaudeCapabilities(initResult)` — שכבר כולל rename/thinkingTokens (capabilities.ts:29-41, לא הזרקה נפרדת). ה-FE יקבל אותם דרך delivery נפרד (Model B, iii-2/FE-norm), **לא** מהפריים הגולמי של claude.
- **ext**: `_drive/*` מגיע מה-FE מעל ה-wire → agentApp.onRequest handler (קיים מ-C3, in-process-host.ts:193-212) → query/SDK. `ProviderConnection.ext` נשאר undefined (ext חי בתוך ה-wire, לא BE-initiated).
- **pid**: ה-claude child תחת ה-SDK — חשוף אם נגיש (`(claudeAgent as any).sessions[...]`? או process-level). אם לא נגיש → `null` + תעד.
- **close**: סגור agentApp + ClaudeAcpAgent (SDK kill).

## §4 — Commits
0. stream-adapter + test (fake: write→agentEnd reads; agentEnd writes→onLine). typecheck.
1. `connectInProcess` (rework host → stream-exposed) + ProviderConnection wrap. unit + (אם אפשר) live-test מותאם.
2. export + findings + walkthrough.

## §5 — DoD
| # | בדיקה |
|---|------|
| 1 | typecheck + tests ירוקים |
| 2 | `connectInProcess` מיוצא מ-`@drive-coding/provider/connection`; חתימה = ConnectOpts→ProviderConnection |
| 3 | **שרשרת חיה** (אם CLI זמין): connectInProcess → דרך ה-wire (כמו FE) initialize+prompt → claude עונה |
| 4 | onFrame מפוענח (in+out); turn.isBusy בturn; capabilities כולל rename/thinkingTokens=true |
| 5 | ext `_drive/setThinkingTokens` מעל ה-wire → claude (agentApp handler) — לא נשבר |
| 6 | additive — provider/** + docs/**; אין נגיעה ב-BE/FE |

## §6 — Risks
| סיכון | מיטיגציה |
|---|---|
| `Stream` של acp-sdk-v1 — צורה לא ידועה (1.0 vs 0.21 ndJsonStream) | §3 — אמת מול acp-sdk-v1 d.ts; §7 escalation אם לא מתיישב |
| rework שובר את ה-host (ext handlers / caps mapping) | שמור את ה-agentApp + handlers verbatim; רק ה-connect משתנה (clientApp→stream). caps = mapClaudeCapabilities (BE-side), לא frame-injection |
| pid לא נגיש in-process | null + תעד (לא חוסם; getRuntimeInfo.pid אופציונלי) |
| ה-live-tests הקיימים (self-driving) נשברים | הסב אותם ל-stream-driven או שמור self-driving כ-helper נפרד |

## §7 — Escalation
- אם `Stream` של acp-sdk-v1 לא מאפשר adapter דו-קצה נקי (onLine/write) → עצור, מרדכי (זה הלב של Model 2).

## §8 — Complexity: 8/10 → calev light (פרימיטיב; אבל stream-rework עדין). אם chain-חי לא ניתן → calev מאמת unit + הסב.

## §9 — שאלות פתוחות
| # | שאלה | ברירת-מחדל |
|---|------|----------|
| 1 | Stream של 1.0 או ndJsonStream של 0.21? | אמת ב-d.ts; ה-host כבר על sdk@1.0 (acp-sdk-v1) |
| 2 | pid נגיש? | נסה sessions[].query/process; fallback null |
