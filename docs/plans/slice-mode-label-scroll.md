# Slice: mode-label-scroll (brief רטרוספקטיבי)

> ‏**סטטוס:** העבודה כבר בוצעה ב-working tree (uncommitted, 0 commits מעל `dev`).
> ‏brief זה נכתב **אחרי** המימוש כדי לאפשר אימות ע"י אביגיל (plan-verifier) וכלב
> ‏(runtime-verifier). depends_on: אין (יושב ישירות על קצה `dev` @ `7444c85`).

## מטרה

‏לאחד את הגלילה בפאנל אפשרויות-הסוכן כך שהגלילה מתחילה מסקשן אפשרויות-הסוכן (ולא רק
‏מרשימת הסשנים), לתקן את תווית בורר ה-mode שהתנגשה עם config-option בשם "Agent",
‏ולהציג תיאורי אפשרויות (descriptions) שמגיעים מה-CLI.

## שינויים (4 צירים)

### 1. אזור גלילה מאוחד — `SessionOptionsPanel.svelte`
- ‏עוטף את **סקשן אפשרויות-הסוכן + סקשן הסשנים** ב-`div` יחיד עם
  `flex-1 min-h-0 overflow-y-auto chat-scroll`. הגלילה מתחילה מראש אפשרויות-הסוכן.
- ‏שורת הפעולות העליונה (connect/disconnect) נשארת **קבועה** (מחוץ לאזור הגלילה).
- ‏סקשן אפשרויות-הסוכן וסקשן הסשנים קיבלו `shrink-0`; רשימת הסשנים הפנימית **איבדה**
  את ה-`overflow-y-auto ... flex-1 min-h-0` הנפרד (גוללת יחד עם האזור המאוחד).
- ‏`BottomSheet.svelte`: גוף ה-sheet עבר מ-`overflow-y-auto` ל-`overflow-hidden`
  (הגלילה מנוהלת בפנים ע"י הפאנל → מונע scroll כפול).

### 2. תווית bורר ה-mode מתורגמת פר-ספק — `SessionOptionsPanel.svelte`
- ‏`CONFIG_NAME_KEYS: Record<string, MessageKey>` — מילון שם-CLI (lowercased) → מפתח i18n.
- ‏`localizeConfigName(name)` — מתרגם אם מוכר, אחרת מחזיר את ה-name המקורי.
- ‏`modeLabel` (`$derived.by`) — לוקח את ה-`name` של ה-config-option בקטגוריית `mode`
  (opencode="Session Mode", claude="Mode", codex="Approval Preset"), מתרגם, fallback
  ל-`t("agentOptions.mode.label")`. מחליף את כל המופעים הקודמים של
  `t("agentOptions.agent.label")` בבורר ה-mode/placeholder.
- ‏extra config-options מציגים `localizeConfigName(opt.name)` במקום `opt.name` הגולמי.
- ‏מפתחות i18n חדשים: `configName.{agent,mode,sessionMode,approvalPreset,model,effort,reasoningEffort}`
  ב-`keys.ts` + `catalogs/he.ts` + `catalogs/en.ts`.

### 3. תיאורי אפשרויות — `Select.svelte` + `SessionOptionsPanel.svelte`
- ‏`SelectOption` קיבל שדה אופציונלי `description?: string | null`.
- ‏`toSelectOptions` מעביר `description` הלאה; הקריאות מעבירות `m.description`/`o.description`.
- ‏ברשימת האפשרויות: שורת description שנייה (`firstLine`, `line-clamp-2`, `--fg-dim`).
- ‏מתחת ל-trigger: `selectedDescription` (שורה ראשונה) עם פריסה/קיפול (`descExpanded`)
  כש-`canExpandDesc`, tooltip (`title`) בדסקטופ, ו-`$effect` שמאפס פריסה כשמשתנה `value`.

### 4. נלווים (scope creep — מסומן במפורש)
- ‏`markdown.ts`: hook `afterSanitizeAttributes` שמוסיף `target=_blank` + `rel=noopener noreferrer`
  לכל `<a>`; `ALLOWED_ATTR` קיבל `target`,`rel`. (אבטחה/UX — לא קשור לגלילה.)
- ‏`agent-session.svelte.ts` + `chat/+page.svelte` + `+page.svelte`: `import.meta.env.DEV`
  → `import.meta.env.MODE !== "production"` (mock sessions פעילים גם ב-dev build);
  פענוח `loadResult` עם `configOptions/models/modes` ב-mock loader.
- ‏fixture חדש: `static/fixtures/claude-demo.json` ("config + descriptions (claude)").

## קבצים שנגעו (12)
```
docs/roadmap.md                                              (+1 שורה, לא קשור)
packages/core/src/i18n/{keys.ts,catalogs/he.ts,catalogs/en.ts}
packages/frontend/src/lib/components/layout/SessionOptionsPanel.svelte
packages/frontend/src/lib/components/layout/BottomSheet.svelte
packages/frontend/src/lib/components/ui/Select.svelte
packages/frontend/src/lib/util/markdown.ts (+ markdown.test.ts)
packages/frontend/src/lib/view-models/agent-session.svelte.ts
packages/frontend/src/routes/{+page.svelte,chat/+page.svelte}
packages/frontend/static/fixtures/claude-demo.json (untracked)
```

## DoD
- [ ] ‏typecheck נקי (`pnpm typecheck`).  ← נבדק ✅ עובר
- [ ] ‏טסטים ירוקים (`markdown.test.ts` 12/12).  ← נבדק ✅
- [ ] ‏בפאנל אפשרויות-סוכן: כשהגובה קטן, **ראש אפשרויות-הסוכן** נגלל (לא נחתך), שורת
      הפעולות העליונה קבועה, ואין שני scrollbars מקוננים.
- [ ] ‏תווית בורר ה-mode מראה "מצב" (claude="Mode") ולא "סוכן"; אין בורר כפול עם "Agent".
- [ ] ‏לכל אפשרות ב-`claude-demo` mock מוצג description (תחת ה-trigger ובתוך הרשימה);
      תיאור ארוך ניתן לפרוס/לקפל.
- [ ] ‏קישור בתוך הודעת markdown נפתח בלשונית חדשה (`target=_blank`).

## אימות (environment)
- ‏`cd packages/frontend && pnpm dev` (Vite, port OS-assigned — לקרוא מה-stdout).
- ‏אין צורך ב-backend/OneCLI — ה-mock רץ לגמרי ב-FE.
- ‏URL לאימות: `http://localhost:<vitePort>/chat?mock=claude-demo`.
- ‏בדיקת גלילה: לצמצם גובה חלון/viewport מובייל ולוודא שראש אפשרויות-הסוכן נגלל.

## claims לאימות (file:line — לאביגיל)
- ‏`SessionOptionsPanel.svelte`: `CONFIG_NAME_KEYS`, `localizeConfigName`, `modeLabel`
  קיימים; אזור הגלילה המאוחד עוטף את שני הסקשנים.
- ‏`Select.svelte`: `SelectOption.description`, `firstLine`, `selectedDescription`,
  `selectedDescriptionFull`, `canExpandDesc`, `descExpanded` קיימים.
- ‏`keys.ts`: 7 מפתחות `configName.*` קיימים ומופיעים גם ב-he.ts וגם ב-en.ts.
- ‏`@drive-coding/core/i18n` מייצא את `MessageKey`.
