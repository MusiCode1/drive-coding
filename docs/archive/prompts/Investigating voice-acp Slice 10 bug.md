אתה סוכן חוקר. המשימה: לחקור בעיה אחת מ-Slice 10 של voice-acp ולכתוב דוח. **אסור כרגע לשנות קוד יישומי.**

שלבים:

1. cd /home/user/projects/voice-acp
2. קרא את `.worktrees/TRACKER.md`. בחר שורה ב-`TODO`.
3. הרץ:
   ```bash
   BUG_ID="<id-מהטבלה>"
   git -C main worktree add ../.worktrees/$BUG_ID main -b bugfix/$BUG_ID
   ```
   אם נכשל עם "already exists" — הbug תפוס. חזור לשלב 2.
4. עדכן את שורתך ב-TRACKER.md (Edit tool, oldString = השורה כולה):
   `TODO` → `INVESTIGATING <ISO-time>` (הרץ `date -Iseconds`)
   `—` → `bugfix/<id>`
5. cd .worktrees/$BUG_ID
   **אל תריץ pnpm install** — אתה רק קורא קוד.
6. קרא את ה-finding ב-`docs/slice-10-exploratory-test-report.md` (חפש את הסקשן `### F-N`).
7. חקור: Grep, Read, עקוב אחרי ה-flow בקוד. בלי להריץ — רק קריאה.
8. כתוב דוח ב-`docs/investigations/<id>.md` לפי התבנית ב-TRACKER (Bug recap, Root cause, Affected files, Reproduction, Proposed fix, Risks, Open questions, Estimated effort).
9. commit את הדוח בלבד:
   ```bash
   git add docs/investigations/<id>.md
   git commit -m "docs(investigation): <id> — root cause + הצעת תיקון"
   ```
10. עדכן TRACKER: `INVESTIGATING ...` → `AWAITING-APPROVAL <commit-hash>` (קצר, 7 תווים).
   commit את עדכון ה-TRACKER לbranch שלך (לא ל-main):
   ```bash
   # הTRACKER מחוץ ל-git, הEdit כבר שמר. שום commit נוסף.
   ```
11. צא. חכה לאבי.

איסורים לשלב המחקר:

- אל תיגע ב-worktrees של באגים אחרים
- אל תשנה קוד יישומי — רק `docs/investigations/<id>.md`
- אל תריץ `pnpm install` / `pnpm test` / `pnpm dev` / tmux — מחקר read-only
- אל תפתור את הbug — רק תכין דוח לאבי
- אם הbug דורש החלטה ארכיטקטונית — רשום אותה ב-"Open questions for Avi" ובאר את הדילמה. אל תחליט בעצמך.

התחל.