# Slice FEAT-thinking-live — פיצ'ר ראשון מקצה-לקצה: thinking-tokens חי (UI→ext→claude) — בריף

> **תאריך**: 2026-06-28 · **סטטוס**: הושלם · **branch**: slice/cutover-migration
> **Complexity**: 6/10 (verifier: light + אימות חי בדפדפן) · **depends_on**: [FE-normalization] · **Base**: HEAD אחרי FE-norm
> **batch-mode. לא ממזגים.** זה ההוכחה: כפתור → claude in-process עושה משהו.

---

## §0 — context

אחרי FE-normalization, ה-FE יכול לשלוח ext מטופס + gating. FEAT-thinking-live מחווט את **הפיצ'ר הראשון
מקצה-לקצה**: פקד-UI ל-thinking-tokens → `ext.setThinkingTokens` → `_drive/setThinkingTokens` מעל ה-WS →
claude in-process מבצע. **זו ההוכחה שכל השרשרת (חבילה→BE→FE→claude) עובדת.**

> thinking-tokens נבחר כי הוא ה-ext היחיד המומש מלא (schema + handler + query). rename/compact/mcp = follow-up.

## §1 — מטרה
פקד-UI (slider/select: low/medium/high/off→n) בהגדרות-הסשן, gated על `vm.supports.thinkingTokens`,
ששולח `ext.setThinkingTokens(sessionId, n)`. אימות חי: claude מקבל ומחיל (thinking budget משתנה).

## §2 — Scope
| כן | לא |
|---|---|
| פקד-UI ל-thinking-tokens ב-SessionOptionsPanel (gated על capabilities) | features אחרים (rename/compact/mcp) |
| חיווט ל-`vm.setThinkingTokens(n)` → `ext.setThinkingTokens` (FE-norm facade) | שינוי package/BE |
| mapping ערכי-UI → n (off=null, low/med/high → טוקנים) | persist (אם פשוט — כן; אחרת follow-up) |
| אימות חי: claude מחיל (thinking chunks/budget) | — |

## §3 — מימוש
- **UI**: ב-`SessionOptionsPanel.svelte` (או היכן שה-config controls), הוסף `<Select>`/slider thinking. `{#if vm.supports.thinkingTokens}`.
- **mapping**: off→`null`, low→4000, medium→8000, high→16000 (ערכים סבירים; n: number|null כמו ה-schema).
- **vm**: `setThinkingTokens(n: number | null)` — מתודה **נפרדת** מ-`applyConfigOption(id, value: string|boolean)` (זה ext, לא configOption ACP סטנדרטי). → `this.#ext.setThinkingTokens(this.sessionId, n)` (facade מ-FE-norm).
- **i18n**: תווית בעברית/אנגלית (lint:i18n — בקטלוגים, לא hardcoded).

## §4 — Commits
0. UI control + mapping + vm.setThinkingTokens + gating. typecheck + i18n.
1. אימות חי (דפדפן + claude אמיתי): שינוי thinking → claude מחיל. findings + walkthrough.

## §5 — DoD
| # | בדיקה |
|---|------|
| 1 | typecheck + lint:i18n ירוקים |
| 2 | פקד מופיע **רק** כש-`vm.supports.thinkingTokens` (gating) |
| 3 | **חי**: שינוי הפקד → `_drive/setThinkingTokens` נשלח (wire) → claude in-process מקבל (לא -32601) |
| 4 | אימות-אפקט: thinking budget השתנה (best-effort — thinking chunks / budget; אם לא דטרמיניסטי, תעד שה-ext הצליח + prompt עוקב עובד) |
| 5 | off→null עובד (ביטול-תקרה) |
| 6 | `pnpm test` ירוק |

## §6 — Risks
| סיכון | מיטיגציה |
|---|---|
| כל השרשרת תלויה ב-3 ה-slices הקודמים (batch) | זה הפיצ'ר האחרון בשרשרת — תלוי שכולם עברו; אם משהו לפני נשבר, יתעכב |
| אימות-אפקט thinking לא דטרמיניסטי | DoD#4 best-effort; ה-ext-הצליח + prompt-עוקב מספיק כהוכחת-שרשרת (כמו C3-ext-thinking) |
| persist מסבך | אם מורכב — דחה; ה-slice הוא ההוכחה, לא persist |
| i18n hardcoded | קטלוגים (he/en); lint:i18n |

## §7 — Escalation
- אם ה-ext לא מגיע ל-claude (chain שבור) → עצור, אבחן באיזה hop (FE facade / wire / BE routing / host handler). זה ה-integration test של כל ה-cutover.

## §8 — Complexity: 6/10 → calev light (UI + אימות חי; השרשרת כבר אומתה ב-slices הקודמים).

## §9 — שאלות פתוחות
| # | שאלה | ברירת-מחדל |
|---|------|----------|
| 1 | ערכי thinking (low/med/high → n)? | 4000/8000/16000; off=null |
| 2 | persist הבחירה? | אם פשוט (כמו restore-last-config) כן; אחרת follow-up |
