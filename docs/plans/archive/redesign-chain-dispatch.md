# Redesign vNext — פרומפט שרשרת סדרתי (dispatch ל-eliezer)

> **תכלית**: להריץ את כל 7 ה-slices של ה-redesign **סדרתית** (לא מקבילי), בשרשרת worktrees,
> בלי merge ל-dev עד שמרדכי+המשתמשת מאשרים בבוקר. כל slice נגזר מה-branch של הקודם.
>
> **מי**: eliezer (executor). **מודל**: Sonnet.
> **מה הוא לא עושה**: לא ממזג ל-dev (מרדכי בלבד), לא כותב briefs (קיימים), לא מכריע אדריכלית.

---

## הפרומפט (להעתקה ל-dispatch)

```
‏בצע את שרשרת ה-slices של redesign vNext באופן סדרתי (לא מקבילי), בשרשרת worktrees.
‏אתה eliezer (executor). אל תמזג ל-dev אף פעם — מרדכי ממזג. אל תכתוב briefs — בצע קיימים.

═══ סביבה ═══
- ‏פרויקט: /home/user/projects/voice-acp (bare+worktrees)
- ‏FE package: @drive-coding/frontend-v2 (לא frontend! התיקייה frontend/ אבל השם -v2)
- ‏הרצה: pnpm --filter @drive-coding/frontend-v2 dev|typecheck|build|test ; pnpm lint:i18n מ-root
- ‏BE (לבדיקות שצריכות proxy): cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts (port 4000)
- ‏Browser: Chrome רגיל מול ה-Vite URL. למובייל: DevTools responsive ~400px.
- ‏i18n: אין מחרוזות עברית קשיחות — t("key"). pre-commit hook חוסם.

═══ ה-slices (סדרתי, בסדר הזה) ═══
‏כל brief ב-dev/docs/plans/slice-redesign-N-*.md. שרשרת: כל slice base = branch של הקודם.
  1. slice-redesign-1-foundation        (base: dev) — ✅ אולי כבר בוצע (בדוק worktree קיים)
  2. slice-redesign-2-layout-shell      (base: slice-redesign-1-foundation)
  3. slice-redesign-3-settings          (base: slice-redesign-2-layout-shell) — צריך אישור Bits UI (ראה למטה)
  4. slice-redesign-4-input-mic         (base: slice-redesign-3-settings)
  5. slice-redesign-5-bubbles           (base: slice-redesign-4-input-mic) — Commit 1 (C1) → phase-verifier
  6. slice-redesign-6-modals            (base: slice-redesign-5-bubbles)
  7. slice-redesign-7-smart-scroll      (base: slice-redesign-6-modals)

═══ הפרוטוקול לכל slice (בסדר) ═══
‏א. אם ה-slice כבר בוצע (worktree קיים + calev GO ב-handoff) — דלג עליו, עבור לבא.
‏ב. צור worktree בשרשור:
     git worktree add .worktrees/<name> -b <name> <branch-של-הקודם>
     cd .worktrees/<name> && pnpm install && pnpm hooks:install
   ‏(ל-slice 2: base = slice-redesign-1-foundation. ל-slice 3: base = slice-redesign-2-layout-shell. וכו'.)
‏ג. ⚠️ PLAN-GATE — לפני שמתחילים לכתוב קוד:
     ‏ה-briefs 3-7 אומתו ע"י אביגיל מול *תכנון*, לא מול הקוד של ה-slices שלפניהם (שלא היו קיימים).
     ‏עכשיו הקוד הקודם קיים בשרשרת. **הרץ אביגיל מחדש על ה-brief** לפני ביצוע:
       Task(subagent_type="avigail", prompt="בדקי את ה-brief dev/docs/plans/<name>.md מול הקוד
       ב-worktree .worktrees/<name> (base כולל את כל ה-slices הקודמים בשרשרת). אמתי שכל סמל/נתיב/
       API שה-brief מניח מ-slices קודמים אכן קיים עכשיו. Project root: .worktrees/<name>")
     - ‏אם verdict=READY → המשך ל-ד.
     - ‏אם USABLE-AFTER-FIX/NEEDS-REWORK → **עצור ודווח למרדכי** (אל תתקן brief בעצמך — זו עבודת מרדכי).
     ‏(ל-slice 1+2 שכבר READY מראש — אפשר לדלג על ה-gate, אבל אם base זז, הרץ בכל זאת.)
‏ד. קרא את ה-brief במלואו. בצע commit-by-commit לפי §4. אל תרחיב scope (§2 "קו אדום").
‏ה. אחרי כל commit: הרץ את ה-Verification של אותו commit. ירוק לפני git add.
   ‏ל-slice 5 Commit 1 (C1 segments) — הרץ calev phase-verifier אחריו (ה-brief מציין).
‏ו. בסוף ה-slice: עבור על §5 DoD פריט-פריט. הרץ typecheck+build+test+lint:i18n — כולם נקיים.
‏ז. הפעל calev (mode: light) על ה-slice:
     Task(subagent_type="calev", prompt="mode: light
     Brief: dev/docs/plans/<name>.md
     Slice: <name>
     Commit: <hash אחרון>
     Worktree: .worktrees/<name>
     ‏סביבה: FE על Vite, BE על 4000 (OneCLI) לבדיקות proxy. בדוק את ה-DoD של ה-brief.
     ‏4 פלטות מתחלפות (DevTools data-palette) זמינות מ-slice 1.")
‏ח. אם calev=GO → עבור ל-slice הבא (גזור מה-branch הזה).
   ‏אם PARTIAL/NO-GO → תקן לפי הדוח, הרץ calev שוב. אם עדיין לא GO אחרי סבב תיקון אחד →
   ‏עצור ודווח למרדכי.

═══ אישור Bits UI (לפני slice 3) ═══
‏slice 3 צריך component-lib (Bits UI). ה-brief מסמן זאת כחוסם (§9 שאלה 1).
‏**לפני Commit 3 של slice 3 — עצור ושאל את מרדכי**: "Bits UI מאושר? (pnpm add bits-ui)".
‏אם מרדכי מאשר → המשך. אם לא → המתן.

═══ עצור ושאל את מרדכי אם ═══
- ‏אביגיל מחזירה ≠READY ב-PLAN-GATE (brief צריך תיקון — עבודת מרדכי).
- ‏החלטה אדריכלית שלא ב-brief (§7 escalation של כל brief).
- ‏ספרייה (@lucide/svelte, @tailwindcss/vite, bits-ui) נכשלת באופן שמרמז על אי-תאימות stack.
- ‏calev לא GO אחרי סבב תיקון אחד.
- ‏slice צריך merge ל-dev כדי להמשיך (אתה לא ממזג — דווח שהשרשרת הגיעה לקצה).

═══ תוצר ═══
‏שרשרת worktrees מוכנה ל-merge (לא ממוזגת). לכל slice: branch + commits + דוח calev.
‏דווח בסוף: טבלת slices (GO/נתקע/דולג) + ה-branch של כל אחד (לסדר merge של מרדכי) +
‏אילו slices נעצרו ולמה.
```

---

## הערות למרדכי (לא חלק מהפרומפט)

### למה plan-gate בזמן-אמת
ה-briefs 3-7 נכתבו ואומתו ע"י אביגיל **לפני** שהקוד של ה-slices שלפניהם קיים. אביגיל אישרה את
ה-claims מול dev הקיים (קומפוננטות/VMs/endpoints נוכחיים), אבל **לא** את ה-claims מול redesign-1..6
(שלא היו קיימים). ה-plan-gate בזמן-אמת (שלב ג') סוגר את הפער: אחרי שהקודם בוצע, אביגיל מאמתת את
ה-brief מול הקוד האמיתי שנוצר. זה משלב "כל ה-briefs מוכנים מראש" עם בטיחות "אימות מול קוד אמיתי".

### סטטוס אימות נוכחי (לפני dispatch)
| slice | אביגיל (מול dev) | הערה |
|---|---|---|
| 1 | READY (2 סבבים) | בוצע, calev GO |
| 2 | READY (2 סבבים) | תוקנו 3 findings (scroll/disconnect/hamburger) |
| 3 | תוקן (VoicePicker/carMode); base-findings צפויים | plan-gate יאמת מול 1+2 |
| 4 | תוקן (mappings/crossfade); base-findings צפויים | plan-gate יאמת מול 1-3 |
| 5 | לא אומת (base) | C1 logic אומת מול agent-session/Speaker הקיימים |
| 6 | לא אומת (base) | endpoints (/api/fs/browse, listSessions) אומתו קיימים |
| 7 | לא אומת (base) | scroll-ownership תלוי redesign-2 |

### סדר merge בבוקר (אחרי calev GO לכולם)
A→B→C→D... בסדר: 1→2→3→4→5→6→7. `git merge --no-ff` (לא squash — שובר ancestry בשרשרת).
כל merge דורש אישור מפורש של המשתמשת.
