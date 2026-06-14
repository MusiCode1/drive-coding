# Slice P1d — frontend cutover ל-ProviderSession (DRAFT)

> **סטטוס**: 📝 **DRAFT — לא אומת** (נדייק ונחתום אחרי ביצוע dc-int)
> **Base**: `dev` (drive-coding, אחרי dc-int)
> **Complexity**: ~8/10 (**calev-heavy** — refactor של ה-view-model + UI regression)
> **depends_on**: `[dc-int]`

---

## §1 — מטרה
`agent-session.svelte.ts` מפסיק לצרוך `AcpClient`/`SessionNotification` ישירות, ועובר ל-
`ProviderSession`/`ProviderEvent` דרך ה-registry. זה הופך את drive-coding ל**צרכן קנוני אמיתי** —
multi-provider (acp + claude-code) בלי שה-UI יודע מי הספק.

## §2 — Scope
| פיצ'ר | כן/לא |
|------|------|
| `#client = createAcpClient(...)` → `#session = registry.create(providerId, cfg)` | ✅ |
| `#onSessionUpdate(SessionNotification)` → `#onProviderEvent(ProviderEvent)` | ✅ |
| `#client.prompt/cancel/close` → `#session.sendPrompt/cancel/stop` | ✅ |
| ה-bubbles (`#handleToolCall` וכו') מתמלאים מ-`ProviderEvent` (לא update גולמי) | ✅ |
| **content: string → ToolContent[]** במלואו (היום מצומצם) | ✅ |
| permission UI אמיתי (`permission.request` → respondToPermission) | ✅ |
| בחירת provider ב-UI (acp:X / claude-code) | ✅ (או slice עוקב) |

## §3 — Design highlights
- ה-mapping מ-ACP→ProviderEvent כבר ב-package (P1b). ה-frontend עכשיו צורך ProviderEvent **ישירות**.
- ⚠️ זה ה-slice שבו ה-`#onSessionUpdate` logic (947-1060) **מוחלף** — מה ש-P1b מיפה, ה-UI עכשיו צורך.
- capabilities-gating: ה-UI מסתיר features לפי `session.capabilities` (claude-code: fs/diff/terminal=false).
- regression UI כבד — bubbles, scroll, status, permissions.

## §4 — Commits (outline)
0. `#onProviderEvent` במקביל ל-`#onSessionUpdate` (feature flag). typecheck.
1. החלפת lifecycle (start/prompt/cancel/stop) ל-ProviderSession.
2. bubbles מ-ProviderEvent + content מלא. 
3. permission UI + capability-gating.
4. הסרת ה-ACP-direct הישן. vitest + E2E.

## §9 — לדיוק אחרי dc-int בוצע
- ה-shape הסופי של ProviderEvent בפועל (אחרי P1b merged).
- E2E: acp (opencode) + claude-code דרך אותו UI.
- האם דלת 5 (claude-code content) נדרשת לפני P1d, או ש-acp מספיק להוכחת ה-cutover.
- regression strategy (calev-heavy — visual + flows).
