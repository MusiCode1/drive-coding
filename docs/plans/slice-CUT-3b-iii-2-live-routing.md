# Slice CUT-3b-iii-2 — live routing: claude → connectInProcess (ext חי) — בריף

> **תאריך**: 2026-06-28 · **סטטוס**: בביצוע — calev-heavy pending · **branch**: slice/cutover-migration
> **Complexity**: 8/10 (verifier: **calev-heavy** — behavioral, נתיב חי) + phase-gate · **depends_on**: [CUT-3b-iii-1] · **Base**: HEAD אחרי iii-1
> **batch-mode. לא ממזגים.**

---

## §0 — context

iii-1 בנה `connectInProcess`. iii-2 **מנתב חי**: ה-`connection-registry` (BE, `acp/connection-registry.ts`) היום
תמיד `connectSpawn(cliKind, connectOpts)` (שורה 103). iii-2 מוסיף ניתוב: **`cliKind==="claude"` → `connectInProcess`**,
אחרת `connectSpawn`. אחרי זה — **claude רץ in-process חי, וערוץ ה-ext זמין** (ה-FE שולח `_drive/*` מעל ה-WS → ה-host).

> זה הצעד שמפעיל remote-control חי בצד-ה-BE. (ה-FE עדיין צריך facade+gating — FE-normalization.)

## §1 — מטרה
`registry.connect` מנתב claude→connectInProcess; opencode→connectSpawn. **0 רגרסיה** ל-opencode; **claude עובר ל-in-process** (אותו ProviderConnection — שקוף ל-orchestrator/ws-agent). ext זמין.

## §2 — Scope
| כן | לא |
|---|---|
| `connection-registry.connect`: routing לפי cliKind (claude→connectInProcess) | FE facade/gating (FE-normalization) |
| אימות חי: claude in-process — spawn(=connect)+prompt+תשובה; opencode עדיין spawn | features |
| אימות ext: `_drive/setThinkingTokens` מה-FE מעל WS → claude in-process | שינוי ProviderConnection |
| capability delivery (Model B): ה-BE/host משדר `_drive/capabilities` ל-FE (frame ייעודי) — **או** §9#1 | — |

## §3 — מימוש
- `connection-registry.ts` `connect()`: `const conn = cliKind === "claude" ? await connectInProcess(connectOpts) : await connectSpawn(cliKind, connectOpts)`. השאר (Map, dedup, onCrash) ללא שינוי.
  - ⚠️ **5 cliKinds (🟢 avigail)**: הערכים = opencode/claude/gemini/codex/qoder (`core/src/schemas/agent.ts:30`). רק `claude`→in-process; **כל השאר (כולל gemini/codex/qoder)→connectSpawn** (else-branch). DoD#3 בודק opencode **ועוד אחד**.
- ⚠️ **🔴 getRuntimeInfo short-circuit (avigail)**: `connection-registry.ts:160` עושה `if (pid === null) return null` → מאבד attached/busy/lastMessageAt. iii-1 מתיר `pid:null` ל-in-process. **תקן**: אל תחזיר null על pid-null; החזר `{ pid: null, attached, busy, lastMessageAt }`. (אחרת claude in-process מאבד runtime-info ב-`GET /api/agents` — http-agents.ts:37.)
  - ⚠️ **הרחב את ה-return type** ל-`pid: number | null` בשני המקומות: `connection-registry.ts:54` (חתימת getRuntimeInfo) **וגם** `http-agents` deps:27 — אחרת typecheck (DoD#1) נכשל.
- ⚠️ ה-`connectInProcess` לא מקבל `cliKind` (תמיד claude) — התאם חתימה (connectOpts בלבד).
- **capability delivery (Model B)**: כשה-conn נוצר, ה-BE שולח ל-FE את `conn.capabilities` כ-frame ייעודי (`_drive/capabilities`) על ה-wire (extNotification), או דרך ה-handshake. (אם מורכב — דחה ל-FE-normalization; כאן רק לוודא ש-capabilities נגיש ב-conn.)
- ws-agent/orchestrator: **ללא שינוי** (conn אחיד). אמת שה-wire (onLine/write) עובד עם stream של in-process כמו עם stdio.

## §4 — Commits
0. routing ב-registry (claude→connectInProcess) + phase-gate: calev phase (claude in-process spawn+prompt עובד).
1. capability delivery (`_drive/capabilities` frame) — או דחייה מתועדת. + אימות ext חי.
2. אימות מלא + findings + walkthrough.

## §5 — DoD (behavior-preserving + ext חי)
| # | בדיקה |
|---|------|
| 1 | typecheck ירוק |
| 2 | **claude in-process חי** — POST /api/agents (claude) → conn=connectInProcess → prompt → claude עונה ב-FE (calev-heavy) |
| 3 | **opencode עדיין spawn** — 0 רגרסיה (connectSpawn) |
| 4 | **ext חי** — `_drive/setThinkingTokens` מה-FE (מעל WS) → claude in-process מבצע (לא -32601) |
| 5 | wire/turn/attach/crash — claude in-process מתנהג כמו spawn (getRuntimeInfo עובד) |
| 6 | model picker (claude) — modelOverride עדיין עובד in-process (או תעד אם in-process שונה) |
| 7 | `pnpm test` ירוק (פרט ל-2 pre-existing) |

## §6 — Risks
| סיכון | מיטיגציה |
|---|---|
| in-process wire לא מתנהג כמו stdio ב-ws-agent (timing/framing) | calev-heavy חי; phase-gate; ws-agent ללא שינוי = אם conn אחיד עובד, זה עובד |
| modelOverride in-process | **מטופל ב-iii-1** (connectInProcess מחווט modelOverride ל-session-creation). כאן רק DoD#6 מאמת חי. אם FE קובע model דרך configOption (runtime) ולא spawn-flag — אמת ששני הנתיבים עובדים |
| capability delivery מורכב | דחה ל-FE-normalization (DoD#4 מספיק כ-BE-side proof) |
| claude in-process crash שונה מ-spawn crash | conn.onCrash אחיד; אמת registry.update(crashed) |

## §7 — Escalation
- אם ה-wire של in-process לא מתנגן עם ws-agent (ה-FE לא מקבל frames) → עצור. זה ה-seam של Model 2.
- אם modelOverride לא עובר in-process → מרדכי (ייתכן שצריך נתיב model נפרד ל-in-process).

## §8 — Complexity: 8/10 → calev-heavy (claude חי in-process + ext; edge/regression מול spawn). phase-gate אחרי routing.

## §9 — שאלות פתוחות
| # | שאלה | ברירת-מחדל |
|---|------|----------|
| 1 | capability delivery כאן או ב-FE-normalization? | minimal כאן (frame ייעודי); ה-gating המלא ב-FE-norm |
| 2 | modelOverride in-process — איך? | אמת מול ה-host; ייתכן session opt / _meta |
