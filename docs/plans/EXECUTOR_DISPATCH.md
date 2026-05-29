# Executor Dispatch — Pre-conditions ‏וקונבנציות

> **‏לכל ‏מי שמקבל ‏brief**: ‏הקובץ ‏הזה ‏הוא ‏ה-boilerplate ‏המשותף ‏לכל ‏ה-slice executions.
> ‏ה-brief ‏מפנה ‏אליו ‏ב-§0; ‏אל ‏תחזור ‏עליו.
> ‏אם ‏ה-brief ‏סותר ‏משהו ‏פה — ‏הbrief ‏מנצח. ‏אם ‏לא ‏ברור — ‏זה ‏Escalation.

---

## 0. ‏Role — ‏אתה ‏הexecutor

‏אם ‏קיבלת ‏prompt ‏מ-Tama ‏שאומר "‏בצע ‏docs/plans/slice-X.md" — **‏אתה ‏הexecutor**.
‏אל ‏תdelegate ‏ל-sub-agent ‏מסוג `executor` ‏עם Task. ‏אתה ‏מבצע ‏ישירות.

‏ה-Task tool ‏עם ‏executor/verifier sub-agents קיים — ‏אבל ‏השימוש ‏היחיד שלך בו:

| ‏Sub-agent | ‏מתי |
|---|---|
| `verifier-phase` | ‏אחרי ‏commit ‏שה-brief ‏מסמן ‏לphase verifier |
| `verifier-slice-light` | ‏בסוף, ‏אם ‏ה-brief ‏מסמן ‏light |
| `verifier-slice-heavy` | ‏בסוף, ‏אם ‏ה-brief ‏מסמן ‏heavy |
| `general` | ‏מחקר ‏רוחבי ‏(read-only ‏עזר) — ‏לא ‏ליישום |
| `executor` | ❌ ‏אל ‏תקרא ‏לו. ‏אתה ‏הוא. |

‏אם ‏הbrief ‏גדול ‏מאוד ‏ויש ‏פיתוי ‏לדelegate — ‏עצור ‏ושאל את Tama ‏לפצל ‏ל-2 slices.

---

## 1. ‏Worktree

‏כל ‏slice ‏מקבל worktree ‏משלו ב-`.worktrees/<slice-name>/`. ‏הbrief ‏אומר ‏איזה ‏שם.

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/<slice-name> -b <slice-name> dev
cd .worktrees/<slice-name>
pnpm install
pnpm hooks:install   # ‏חובה — ‏מפעיל pre-commit hook ל-Hebrew lint
```

**‏Critical**: ‏בלי ‏`pnpm hooks:install` — ‏ה-pre-commit ‏לא ‏ירוץ, ‏מחרוזת ‏עברית ‏בקוד ‏תיכנס ‏ל-commit.

‏ה-`dev tip` ‏שצוטט ‏ב-brief ‏הוא ‏ה-base — ‏ה-worktree ‏יתחיל ‏ממנו.

---

## 2. ‏Ports — ‏חוק ‏הברזל

**‏אם ‏port 4000 ‏פנוי**: ‏BE על 4000 (default).
**‏אם ‏port 4000 ‏תפוס** (e.g. dev workspace ‏רץ, ‏או executor אחר ‏פתח): ‏עבור ‏ל-4001, ‏4002, ‏וכו'.

**‏אסור ‏לשאול ‏את ‏Tama** ‏על ‏הבחירה ‏הזו. ‏בדוק ‏עם `ss -tln | grep :4000` ‏או ‏פשוט ‏נסה ‏4000 ‏ואם ‏EADDRINUSE — ‏עבור ‏לבא ‏חופשי.

‏**אסור ‏להרוג** ‏BE/FE/tunnel ‏רץ ‏ש-Tama ‏הפעילה ‏ידנית. ‏היא ‏משתמשת ‏בהם ‏לבדיקות.

```bash
# ‏BE על port חופשי (דוגמה: 4001)
cd packages/backend
PORT=4001 onecli run --agent voice-acp -- bun --watch src/server.ts

# ‏FE — ‏צריך לדעת ‏באיזה BE port ‏הוא משתמש
BE_PORT=4001 pnpm --filter @drive-coding/frontend-v2 dev
```

‏FE ‏תמיד OS-assigned — ‏אין collision possible.

---

## 3. ‏BE חייב OneCLI

‏הBE proxy ‏ל-`api.elevenlabs.io` ‏ול-`generativelanguage.googleapis.com` ‏דורש ‏credentials ‏שOneCLI מזריק. ‏הפעלה ‏רגילה ‏עם ‏`pnpm dev` ‏תיכשל ‏עם ‏401 ‏על ‏כל ‏קריאת TTS/translate/STT.

‏הפקודה ‏הנכונה:
```bash
onecli run --agent voice-acp -- bun --watch src/server.ts
```

‏אם ‏ה-slice ‏BE-only ‏ו-בכלל ‏לא ‏נוגעת ‏ב-TTS/Gemini — ‏פחות ‏קריטי, ‏אבל ‏כלל ‏האצבע: ‏תמיד OneCLI.

‏פירוט ‏ב-AGENTS.md (root) §Backend MUST run through OneCLI.

---

## 4. ‏Tunnel

‏רק ‏אם ‏ה-slice ‏דורש ‏בדיקת ‏Mic ‏(HTTPS חובה) ‏או ‏בדיקת mobile:

```bash
ssh -i ~/.ssh/pico \
  -o StrictHostKeyChecking=accept-new \
  -o ServerAliveInterval=15 \
  -R drive-coding:80:localhost:<vite-port> tuns.sh http
```

‏URL: ‏`https://your-app.tuns.sh`

**‏אסור** ‏להרוג tunnel ש-Tama ‏הפעילה. ‏אם ‏את ‏צריכה tunnel נפרד — ‏השתמש ‏ב-`-R drive-coding-<slice>:80:...` ‏(שם ‏שונה ‏= ‏subdomain ‏נפרד).

---

## 4.5 ‏Testing strategy — ‏פר ‏commit ‏לפי ‏ה-brief

‏ה-brief ‏מציין ‏עבור ‏כל ‏commit ‏את ‏ה-approach: **‏tdd**, ‏**‏integration**, ‏**‏manual**, ‏או ‏**‏none**.

‏(המילים ‏ב-brief ‏שלנו: ‏`approach: TDD` ‏או ‏`approach: manual`. ‏ה-executor.md ‏הגלובלי ‏מצפה ‏ל-`Testing: ...` — ‏אותה ‏סמנטיקה, ‏מילה ‏שונה. ‏פעולה ‏זהה.)

| ‏approach | ‏מה ‏לעשות |
|---|---|
| ‏tdd | ‏Red-Green-Refactor. ‏Test ‏אדום ‏קודם, ‏אז ‏קוד שירוק, ‏אז refactor. |
| ‏integration | ‏Code first, ‏אז ‏integration test ‏בתוך ‏אותו ‏commit. |
| ‏manual | ‏אין ‏tests ‏אוטומטיים. ‏בדיקה ‏ידנית ‏בbrowser/curl. ‏תעד ‏ב-commit message. |
| ‏none | ‏typecheck + lint רק (docs/config/rename pure). |

‏**‏אסור ‏לסטות** ‏מההוראה ‏של ‏ה-brief. ‏אם ‏אתה ‏חושב ‏שעדיף ‏לכתוב ‏test ‏ל-commit ‏שמסומן ‏manual — ‏Escalate.

‏אם ‏ה-brief ‏לא ‏ציין ‏לcommit ‏ספציפי: ‏defaults ‏לפי ‏סוג ‏העבודה:
- ‏logic / protocol / schema → ‏tdd
- ‏refactor של ‏קוד ‏קיים → ‏integration
- ‏ui / styling → ‏manual
- ‏docs / config / rename → ‏none

---

## 5. ‏Verifier protocol

‏ה-brief ‏אומר ‏איזה verifier ‏ומתי. ‏שלוש ‏רמות:

| ‏Verifier | ‏מתי |
|---|---|
| ‏`verifier-phase` | ‏אחרי ‏commit ‏מסוים ‏(ה-brief ‏יציין ‏אחרי איזה) — ‏לפני ‏שתמשיכי ‏ל-commit הבא |
| ‏`verifier-slice-light` | ‏אחרי ‏ה-commit ‏האחרון, ‏לפני ‏שמודיעים "‏גמרתי". ‏Default ‏לרוב ‏slices. |
| ‏`verifier-slice-heavy` | ‏רק ‏אם ‏ה-brief ‏מציין ‏(complexity 8+). ‏פרוטוקול ‏מקיף ‏יותר. |

‏ה-verifier ‏הוא ‏sub-agent. ‏הפעלי ‏אותו ‏עם ‏`Task(subagent_type="verifier-slice-light")` ‏ועוקבת ‏אחרי ‏הoutput.

---

## 6. ‏Escalation — ‏מתי לעצור ולשאול

**‏עצרי ‏ושאלי ‏את ‏Tama** ‏רק ‏אם:

1. ‏ה-brief §7 ‏מציין ‏את ‏המצב ‏הזה ‏כ-trigger
2. ‏החלטה ‏ארכיטקטונית ‏שלא ‏מכוסה ‏(D1-D50 ‏או ‏ה-brief)
3. ‏ספרייה ‏או tool ‏נכשלים ‏באופן ‏שמעיד ‏על stack ‏שגוי (לא ‏באג ‏ספציפי)
4. ‏מצאת ‏שצריך ‏לשנות API ‏ציבורי ‏שלא ‏ב-scope

**‏אל ‏תשאלי ‏על**:
- ‏בחירת port (יש קונבנציה — §2)
- ‏איך ‏ליצור worktree (§1)
- ‏איך ‏להפעיל BE (§3)
- ‏איזה ‏style ‏לכתוב ‏cleanup logic (החלטה ‏לוקלית, ‏רשמי ‏ב-commit msg)
- ‏שיקול ‏אסתטי ‏(font size, spacing) — ‏החליטי, ‏Tama תחזור אם רוצה ‏אחרת

‏ספק? ‏בחר ‏את ‏האופציה ‏הפשוטה ‏יותר ‏ורשום ‏בcommit message ‏מה ‏החלטת.

---

## 7. ‏Workflow general

```
‏לכל commit:
  ‏1. ‏בצע ‏את ‏השינוי ‏לפי ‏ה-brief
  ‏2. pnpm typecheck (לוודא ‏שלא ‏שברת ‏types)
  ‏3. pnpm lint:i18n (חוסם ‏Hebrew בקוד)
  ‏4. (אם רלוונטי) pnpm test
  ‏5. git add ‏רק ‏את ‏מה ‏ששייך ל-commit הזה (לא git add -A)
  ‏6. git commit עם message ‏לפי הdoc convention (פתח עם prefix כמו feat, fix, docs)
  ‏7. (אם ‏ה-brief ‏מציין phase verifier אחרי commit הזה) — ‏הפעלי ‏את ה-verifier

‏בסוף ה-slice:
  ‏1. ‏commit ‏אחרון: walkthrough + slices.md status + brief status
  ‏2. ‏verifier-slice-light
  ‏3. ‏דווחי ל-Tama: ‏branch מוכן, סטיות, ‏מה ‏הסיכון, ‏צריך merge.
```

---

## 8. ‏Pre-commit hook

‏הוא ‏רץ ‏אוטומטית ‏אחרי `pnpm hooks:install` ‏ובודק: ‏אין ‏מחרוזות ‏עברית ‏בקוד ‏(רק ב-i18n catalogs ‏ב-`packages/core/src/i18n/catalogs/` ‏או ‏בdocs).

‏אם ‏הוא ‏חוסם:
- ‏סביר ‏להניח ‏ששכחת ‏לעבור ‏לi18n. ‏השם ‏את ‏המחרוזת ‏ב-catalog + ‏השתמשי ‏ב-`t(key)`.
- ‏אם ‏זה ‏באמת ‏צריך ‏להישאר (e.g. ‏prompt ל-LLM) — ‏השם ‏ב-`packages/core/src/voice/*.ts` (whitelisted) ‏או ‏שאל ‏את ‏Tama.

‏אל ‏תעקפי ‏עם ‏`--no-verify` ‏אלא ‏אם ‏Tama ‏אישר.

---

## 9. ‏מה ‏לעשות ‏בסיום

‏הbrief ‏אומר ‏איזה ‏סטטוס ‏לעדכן ‏(כללית: status ‏ב-`packages/frontend/docs/slices.md`, ‏סטטוס ‏ב-brief ‏עצמו).

‏אל ‏תcommit על דעת עצמך ‏ל-dev. ‏ה-branch מוכן, Tama תעשה merge.

‏אל ‏תfush ל-remote (אין remote כרגע ‏בכל ‏מקרה).

---

## 10. ‏TL;DR

```
1. ‏worktree ב-.worktrees/<name>/ + pnpm install + pnpm hooks:install
2. ‏Port: ‏4000 אם פנוי, ‏אחרת 4001/4002 (אל תשאל, אל תהרוג)
3. ‏BE עם onecli run --agent voice-acp -- ...
4. ‏פר commit: ‏typecheck + lint:i18n + test
5. ‏verifier-slice-light בסוף (phase verifier אם הbrief אומר)
6. ‏ה-branch מוכן, Tama תעשה merge
```
