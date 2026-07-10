# Slice FE-normalization — capability-gating + typed ext-facade בצד-לקוח — בריף

> **תאריך**: 2026-06-28 · **סטטוס**: הושלם (2026-06-29) · **branch**: slice/cutover-migration
> **Complexity**: 7/10 (verifier: light + אימות חי בדפדפן) · **depends_on**: [CUT-3b-iii-2] · **Base**: `slice/cutover-migration` @ `bdc88c1` (iii-2 בוצע — היצרן קיים)
> **לא ממזגים.** ✅ **היצרן של `_drive/capabilities` קיים**: `packages/backend/src/delivery/ws-agent.ts` שולח **raw JSON-RPC notification** (`feWs.send`) אחרי attach (iii-2 commit `255bca8`). ה-SDK (ClientSideConnection) **default-route** notification לא-מוכר → `client.extNotification` → שם ה-vm קולט. זה המנגנון.

---

## §0 — context

אחרי iii-2, claude in-process חי ו-ext זמין ב-BE. FE-normalization מחווט את **צד-הלקוח**: ה-FE קורא את
`NormalizedCapabilities` (gating ל-UI) + facade מטופס לשליחת `_drive/*` (מעל ה-WS). העיקרון: **ה-FE לא יודע מי הספק** —
שני קלטים: capabilities (מה נתמך) + ה-schema (`@drive-coding/provider/extensions`, מ-EXT-SCHEMA).

## §1 — חוזה (מה ש-feature מסתמך עליו)
```ts
// adapters: AcpClient מקבל extMethod (passthrough ל-ClientSideConnection.extMethod — acp.d.ts:546)
client.extMethod(method: string, params: Record<string,unknown>): Promise<Record<string,unknown>>
// adapters: ExtClient facade מטופס מעל ה-schema
ext.setThinkingTokens(sessionId, n): Promise<void>   // validate(params) → client.extMethod("_drive/setThinkingTokens", p)
// view-model: vm.capabilities: NormalizedCapabilities  (מ-_drive/capabilities frame)
```

## §2 — Scope
| כן | לא |
|---|---|
| `AcpClient.extMethod` + **`extNotification` ב-`client-impl.ts`** (נקודת-קליטה ל-`_drive/capabilities`) | features (feature slice) |
| **subpath `./types`** (types-only, `src/types.ts` — ללא spawn-core) — ל-`import type NormalizedCapabilities` ב-FE בלי לשבור vite | — |
| `ExtClient` facade (adapters) — מטופס מעל `extMethods` schema; validate params לפני שליחה | שינוי BE/package |
| view-model קולט `NormalizedCapabilities` מ-`_drive/capabilities` frame → `vm.capabilities` | פיצ'רים חדשים בסכמה |
| **gating** primitive — getter/helper ב-vm ש-UI נקשר אליו (`vm.supports.thinkingTokens`) | — |
| tests (vm + facade) | — |

## §3 — מימוש
- **`client.ts` + `client-impl.ts`** (`@drive-coding/provider/client`):
  - הוסף `extMethod(method, params)` → `conn.extMethod(method, params)` (ClientSideConnection — acp.d.ts:546). additive ל-AcpClient.
  - ⚠️ **🔴 extNotification ingestion (avigail)**: `_drive/capabilities` מגיע כ-**extNotification** (לא session/update!). ה-יצרן קיים (ws-agent, iii-2). אבל `createClientImpl` **לא מממש `extNotification`** → אין נקודת-קליטה. הוסף ל-`createClientImpl` handler `extNotification(method, params)`.
  - ⚠️ **🟡 חתימת createAcpClient (avigail)**: `createAcpClient(transport, onUpdate)` מקבל callback **אחד** (onUpdate ל-session/update). צריך **callback שני** ל-onExtNotification — שנה את החתימה ל-`createAcpClient(transport, { onUpdate, onExtNotification })` (או הוסף param). עדכן את כל ה-call-sites (sessions.ts/agent-session) + ה-mocks בטסטים.
- **`ExtClient`** (FE — שכבת **adapters** בלבד, לא view-model): `setThinkingTokens(sessionId, n)` → `parseExtParams(...)` → `client.extMethod(...)`. ה-vm קורא ל-facade.
- **capability ingestion (תיקון מ-onSessionUpdate ל-extNotification)**: ה-vm נרשם ל-`client.onExtNotification` → על `_drive/capabilities` → `this.#capabilities = params as NormalizedCapabilities`. **לא** ב-`#onSessionUpdate` (זה לא session/update).
- **⚠️ 🟡 import NormalizedCapabilities (vite — avigail)**: `@drive-coding/provider/host` מושך `node:child_process` (spawn-core) → **vite build crash** (barrel-break היסטורי!). השתמש ב-**`import type { NormalizedCapabilities }`** מ-subpath **types-only** (הוסף `./types` ל-exports שמייצא רק `src/types.ts` — pure, ללא spawn-core). אל תייבא value מ-`/host` ב-FE.
- **gating**: `get supports() { return this.#capabilities ?? {כל false} }`. UI: `{#if vm.supports.thinkingTokens}`.

## §4 — Commits
0. `AcpClient.extMethod` + test. typecheck.
1. `ExtClient` facade + capability ingestion ב-vm + gating getter + tests.
2. אימות חי (דפדפן): capabilities מגיע, facade שולח ext. findings + walkthrough.

## §5 — DoD
| # | בדיקה |
|---|------|
| 1 | typecheck + tests (vm + facade) ירוקים |
| 2 | `client.extMethod` עובד — passthrough ל-ClientSideConnection.extMethod |
| 3 | `ext.setThinkingTokens` מאמת params (schema) ושולח `_drive/setThinkingTokens` |
| 4 | `vm.capabilities` נטען מ-`_drive/capabilities` frame; `vm.supports.thinkingTokens` נכון |
| 5 | gating: UI יכול לעשות `{#if vm.supports.X}` (אימות חי או unit) |
| 6 | ה-FE לא מסעיף על cliKind — רק capabilities+schema |
| 7 | additive — FE + client.ts + docs; אין BE rewire |

## §6 — Risks
| סיכון | מיטיגציה |
|---|---|
| ClientSideConnection לא חושף extMethod | acp.d.ts:546 (ext-mechanisms doc) — אמת; אם לא, sendRequest raw |
| `_drive/capabilities` frame לא מגיע (תלוי iii-2) | iii-2 §9#1; אם נדחה — קלוט מ-initialize._meta או handshake |
| FE 5-layer — facade במקום הנכון | adapters (לא view-model); ה-vm קורא ל-facade |
| schema import ב-FE (ESM/vite) | `@drive-coding/provider/extensions` כבר נבדק import חוצה-חבילה (EXT-SCHEMA) |

## §7 — Escalation
- אם capability delivery לא קיים (iii-2 דחה) → קלוט מ-`initialize` response (capability-frame interception על ה-host) או תאם עם מרדכי.

## §8 — Complexity: 7/10 → calev light (FE; אימות חי בדפדפן ל-gating+facade).

## §9 — שאלות פתוחות
| # | שאלה | ברירת-מחדל |
|---|------|----------|
| 1 | facade ב-adapters או view-model? | adapters (engine/adapter layer); vm קורא | 
| 2 | capabilities מ-frame או initialize._meta? | frame (Model B, iii-2); fallback initialize._meta |
