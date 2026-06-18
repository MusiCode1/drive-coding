# Slice — slash-commands (3b) — תוכנית + חסימה

+ **תאריך:** 2026-06-18 · **סטטוס:** 🚫 **חסום** (דורש עבודה ב-`provider-abstraction`) · **מקור:** `docs/plans/ui-feature-backlog.md` §3b
+ **שייך ל-roadmap:** Track A (Provider Engine) → ואז Track C (UI). **לא סבב UI-only.**

## §1 — מטרה (כשייפתר)

תיבת הפרומפט: הקלדת `/` פותחת dropdown autocomplete של הפקודות הזמינות בסשן (עם תיאור),
ניווט מקלדת + בחירה. רשימת הפקודות **דינמית** — מגיעה מה-agent.

## §2 — הממצא המכריע (מאומת מהקוד, 2026-06-18)

slash דינמי **חסום ב-FE-only** כי המידע לא עובר את ה-contract הקנוני:

1. ✅ **פרוטוקול ACP תומך מלא** — `available_commands_update` (`AvailableCommandsUpdate { availableCommands: AvailableCommand[] }`,
   כל פקודה `{ name, description, input? }`) ב-`@agentclientprotocol/sdk` (`SessionUpdate` union).
2. ✅ **claude-code adapter** מקבל `commands_changed` (`SystemCommandsChangedFrame`).
3. ❌ **אבל ה-contract הקנוני לא ממפה אותו** — `provider-contract/dist/adapters/claude-code/session/frameToEvent.js`
   מחזיר אותו כ-`{ type: "raw", provider: "claude-code", frame }` (יחד עם `thinking_tokens`, `compact_boundary`).
   ה-`ProviderEvent` union אין בו וריאנט `commands`.
4. ❌ **ה-FE לא מטפל ב-`raw` events** — `agent-session.svelte.ts #onSessionUpdate` אין בו טיפול ב-raw,
   ואין state עבור `availableCommands`.

> זהו אותו דפוס כמו **TodoWrite/plan** (backlog §6.7) — "דלת" ב-`canonical-mapping-gaps` שעדיין לא ממופה.

## §3 — מה צריך (כשנעבוד על provider-abstraction)

1. **contract** (`provider-abstraction` repo): הוסף וריאנט קנוני ל-`ProviderEvent`, למשל
   `{ type: "commands.available"; commands: AvailableCommand[] }`. מַפֵּה `available_commands_update`
   (ACP) ו-`commands_changed` (claude-code) אליו ב-`frameToEvent` / `map-acp-notification`.
2. **drive-coding FE** (סבב UI):
   + `AgentSession`: `availableCommands = $state<AvailableCommand[]>([])` + handler ב-`#onSessionUpdate`.
   + `TypeArea`: `/`-trigger dropdown (fuzzy match על `name`, תצוגת `description`, kbd-nav, chip/insert).
   + i18n לרכיב ה-dropdown.

## §4 — חלופות (אם רוצים ערך לפני עבודת ה-contract)

| חלופה | הערכה |
|------|------|
| **A. static commands** — רשימה hardcoded ב-FE | אין סנכרון עם ה-agent; ערך מוגבל; עלול להטעות (פקודות שלא קיימות). |
| **B. raw-event ב-FE** — לקרוא את ה-`raw` frame ישירות ב-`#onSessionUpdate` | שביר — תלוי במבנה פנימי של ה-frame הספציפי-לספק; שובר את עקרון הנורמליזציה; חוב טכני. |
| **C. (מומלץ) לדחות** — לבצע נכון יחד עם הרחבת ה-contract | תואם roadmap ("drive-coding = צרכן בלבד"); ערך מלא ודינמי. |

## §5 — המלצה

**לדחות (חלופה C).** לכרוך את 3b בעבודה על `provider-abstraction` שתמפה את `available_commands_update`
לאירוע קנוני — ואז ה-FE הוא slice קטן מעליו. זהה לעיקרון שבו נדחה C13 (כותרת-סשן) ב-batch ה-UI הקודם:
מה שנוגע ב-VM/contract שמורים לסבב הייעודי.
