# חקירה — ארגון חבילת `packages/provider` (בלאגן פוסט-cutover)

> **תאריך**: 2026-07-01
> **סטטוס**: תיעוד-מצב + עיצוב-יעד. **לא לביצוע עכשיו** — קודם מתקנים את באג ה-warm-reattach.
> **רלוונטי ל**: `@drive-coding/provider`, provider cutover (v0.8.0), תיקון warm-reattach
> **קשור**: `2026-07-01-warm-reattach-initialize.md`

## תקציר

זו הפעם הראשונה שמישהו צלל לתוך `packages/provider` כדי להבין אותה (בעקבות באג
ה-warm-reattach). המסקנה: החבילה **עובדת ולא ענקית (2806 שורות, קובץ מקסימלי 345),
אבל היא צמחה אורגנית מתוך ה-cutover** ולא עוצבה מחדש בניקיון. יש בה צלקות-הגירה
ברורות: תיקיית-רפאים, פיצול-spawn משולש, שני shapes ל-capabilities שאיש לא מגשר
ביניהם, ושני אוצרי-מילים לאותו מושג.

**הקשר**: ה-cutover (2026-06-29, v0.8.0) ספג את החבילה החיצונית פנימה ושמר אותה
עובדת — במכוון לא עיצב אותה מחדש. הבלאגן הזה צפוי לשלב, והתיעוד הזה נועד לתעד אותו
ולנעול עיצוב-יעד למתי שנגיע לניקיון — **אחרי** שהבאג יתוקן.

## מה כן בסדר

- גודל סביר: 2806 שורות סה"כ, הקובץ הגדול ביותר 345 שורות. אין monster-files.
- הפרדת client / transport / connection הגיונית בבסיסה (שני קצוות של pipe + אמצע).
- `typecheck` ירוק, אין `any` פרוע.

## המצב הנוכחי — הבלאגן (עם ראיות)

### 1. `host/` היא תיקיית-רפאים

`src/host/` מכילה **רק** `index.ts`, בלי שום קוד משלה. ה-barrel מושך מ-3 מקומות:

```ts
// src/host/index.ts
export { createClaudeInProcessHost, ... } from "../providers/claude/in-process-host.js"
export { createSpawnCore, ... }            from "../shared/spawn-core.js"
export type { AdapterHost, NormalizedCapabilities } from "../types.js"
```

זו לא מודול — זו קופסת-איסוף שמגשרת בין 3 תיקיות שונות.

### 2. פיצול-spawn משולש ומבלבל

מנגנון "הרצת CLI" מפוזר על 3 מיקומים שהשמות שלהם לא מתמפים לאחריות:

| מיקום | מה יש בו |
| --- | --- |
| `src/spawn/` | **רק** types (`BridgeHandle`, `BridgeKind`, `SpawnBridgeInput`) + עזרי-קריסה (`describeCrash`) |
| `src/shared/spawn-core.ts` | ה-spawn **האמיתי** (`createSpawnCore`) |
| `src/connection/spawn.ts` | `connectSpawn` שעוטף את spawn-core ל-`ProviderConnection` |

למה מנגנון ה-spawn האמיתי יושב ב-`shared/` ולא ב-`spawn/`? למה ה-types של spawn
נפרדים מהמימוש? אין הצדקה מבנית — זה תוצר של הגירה.

### 3. שני shapes ל-capabilities בלי גישור — זה מה שנשך אותנו

- `client.ts` מחזיר `agentCapabilities` **גולמי מ-ACP** (`initResult.agentCapabilities`, שורה 156).
- `types.ts` + `connection/capabilities-static.ts` + `providers/claude/capabilities.ts`
  עובדים עם `NormalizedCapabilities` (shape שונה לגמרי).

אף אחד בתוך החבילה לא מתרגם raw → normalized. זו בדיוק נקודת החיכוך שחסמה את
תיקון ה-warm-reattach: נתיב warm רוצה capabilities בלי `initialize`, אבל אין
פונקציית-נרמול יחידה שממנה לשאוב.

### 4. שני אוצרי-מילים לאותו מושג

מונחי "Bridge" (`BridgeManager`, `BridgeHandle`, `BridgeKind`, `SpawnBridgeInput`) —
שרידים מהארכיטקטורה שלפני ה-cutover — חיים לצד מונחי "Connection / Provider" החדשים.
ההערות מלאות ב-`CUT-3b-i`, `CUT-3b-iii` (שלבי cutover). שני שמות לאותו דבר.

### 5. שכבה "גנרית" קשיחה לספק ספציפי

`src/connection/connect-in-process.ts` — שכבה שאמורה להיות גנרית — מייבאת **ישירות**
מ-`providers/claude`:

```ts
import { mapClaudeCapabilities }  from "../providers/claude/capabilities.js"
import { makeAcpClientFromCtx }   from "../providers/claude/client-bridge.js"
import { getQuery }               from "../providers/claude/query-access.js"
```

`connectInProcess` הוא היום claude-only בפועל, אבל ממוקם כאילו הוא גנרי.

### 6. משטח-export עדין מדי

8 subpaths (`./client`, `./transport`, `./transport/ws`, `./config`, `./spawn`,
`./host`, `./extensions`, `./connection`, `./types`) על מודל מושגי של בערך 3 מושגים
אמיתיים. `connection` הוא hub שמושך מ-5 תיקיות (`shared` ×9, `spawn` ×3, `providers`
×3, `types`, `extensions`).

## עיצוב-היעד

### עקרונות

1. **כל תיקיית-על = מושג אחד ברור**, וה-barrel שלה מחזיק/מייצא קוד משלה — בלי
   תיקיות-רפאים.
2. **אוצר-מילים אחד** — "connection / provider / backend". להיפטר מ-"bridge".
3. **shape אחד ל-capabilities** עם נקודת-תרגום *אחת* (raw ACP → Normalized).
4. **כיוון-תלות חד-כיווני**: שכבה גנרית לעולם לא מייבאת ספק ספציפי — הספק מוזרק.
5. **משטח-export שמתאים למספר המושגים** — מ-8 ל-~5.

### העץ המוצע

```
src/
  transport/            # הצינור — כבר נקי, נשאר
    types.ts            #   AcpTransport
    ws.ts · ws-to-streams.ts

  client/               # צד ה-ACP client (פונה ל-FE)
    client.ts           #   createAcpClient + createAttachedAcpClient  ← תיקון warm נכנס כאן
    client-impl.ts
    index.ts

  backend/              # "איך ה-BE משיג agent רץ"  (מאחד: connection + spawn + shared/spawn-core)
    connection.ts       #   ProviderConnection (type + חוזה)
    connect-spawn.ts    #   process חיצוני → ProviderConnection
    connect-in-process.ts #  adapter מוזרק → ProviderConnection (בלי import ישיר לספק)
    spawn-core.ts       #   ה-spawn האמיתי (עבר מ-shared/)
    stream-bridge.ts · crash.ts · turn-tracker.ts

  capabilities/         # בית אחד למודל היכולות
    types.ts            #   NormalizedCapabilities
    normalize.ts        #   raw ACP agentCapabilities → Normalized   ← הגשר החסר
    static.ts           #   fallback לפי cliKind

  providers/            # אדפטרים ספציפיים-לספק — לכל אחד המוזרויות שלו
    claude/             #   in-process host (SDK), rename, thinkingTokens, capabilities
    codex/              #   quirk: "Already initialized" על re-initialize (ר' warm-reattach doc)
    opencode/           #   quirk: shapeEnv (opencode-config plugin), tail/סוף-הודעה

  wire/                 # decode + עזרי-wire משותפים
    decode.ts

  config/               # קונפיג הרצת CLI
  extensions/           # ערוץ _drive/*
```

### המהלכים המרכזיים

| # | מהלך | פותר סעיף |
| --- | --- | --- |
| 1 | מחיקת `host/` — `AdapterHost` עובר ל-`backend/` או `providers/` | §1 |
| 2 | איחוד 3 מקומות-spawn ל-`backend/` אחד | §2 |
| 3 | `capabilities/` אחד + **`normalize.ts` חדש** (raw→Normalized) | §3 |
| 4 | שם "bridge" → "connection / backend" עקבי; ניקוי הערות `CUT-*` | §4 |
| 5 | `connect-in-process` **מקבל** adapter של הספק בהזרקה, לא `import` ישיר | §5 |
| 6 | צמצום משטח-export ל-~5: `./client`, `./transport`, `./backend`, `./capabilities`, `./config`, `./extensions` | §6 |

### כיוון-התלות היעד (אצייקלי)

```
providers/{claude,codex,opencode} ─┐
                                   ├─► backend ─► transport
capabilities ◄─────────────────────┘          └─► wire
client ───────────────────────────────────► transport
config, extensions                          (עצמאיים)
```

הנקודה החשובה ביותר: `capabilities/normalize.ts` — נקודת-התרגום היחידה. ברגע
שהיא קיימת, נתיב ה-warm יכול לקחת capabilities מנורמלות (מה-BE או fallback) בלי
לתלות ב-`initialize`.

## per-provider quirks — למה `providers/<x>/` לכל ספק

כל ספק ACP מתנהג מעט אחרת. היום ההבדלים מפוזרים (חלקם ב-`connection`, חלקם ב-hooks,
חלקם ב-FE). ריכוז לכל ספק בתיקייה משלו:

- **claude** — נטען כ-adapter **in-process** (Anthropic SDK מריץ את Claude Code כ-executable
  חיצוני, אבל אדפטר ה-ACP רץ בתוך ה-BE). תומך `rename`, `thinkingTokens`, `mcp`.
- **codex** — spawn חיצוני. **quirk מאומת**: דוחה `initialize` חוזר עם
  `Already initialized` (ר' `2026-07-01-warm-reattach-initialize.md`). `session/load`
  עובד על process חי בלי re-initialize.
- **opencode** — spawn חיצוני. **quirk**: דורש `shapeEnv` (הזרקת env ל-opencode-config
  plugin); סוגיות tail/סוף-הודעה בזרם.

## מה מפורש **מחוץ** לסקופ עכשיו

- **לא refactor עכשיו** — קודם מתקנים את באג ה-warm-reattach על השכבה החמה שרק
  התייצבה. refactor גדול בשם הניקיון על שכבה טרייה = סיכון מיותר.
- הבעיה הגדולה של multi-client / replay / id-NAT — לא כאן.

## המלצה — סדר-פעולות

1. **עכשיו**: תיקון warm-reattach (`createAttachedAcpClient` בתוך `client/client.ts`
   הקיים). פותר את הבאג בלי לזוז מהמבנה הנוכחי.
2. **אחר-כך, כשיתאים**: slices-ניקיון קטנים ועצמאיים לפי טבלת-המהלכים. סדר מוצע:
   §3 (capabilities/normalize — הכי הרבה ערך, גם משרת עתיד) → §2+§1 (איחוד spawn +
   מחיקת host) → §5 (הזרקת ספק) → §4+§6 (שמות + export). כל אחד slice נפרד עם אביגיל.
