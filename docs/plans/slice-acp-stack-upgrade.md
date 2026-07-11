# Slice — acp-stack-upgrade — שדרוג ACP מלא: client + Claude + Codex — בריף

> **תאריך**: 2026-07-11
> **סוג מסמך**: בריף ביצועי לסלייס — לא תוכנית טרום-בריף
> **סטטוס**: plan-verified
> **אימות אביגיל**: READY r5 — `reports/drive-coding/slice-acp-stack-upgrade-avigail.md`
> **Dispatch**: מותר לאליעזר; plan-gate עבר.
> **Complexity**: 8/10 (verifier: heavy + phase על Commits 1, 3, 4, 5)
> **תלויות (`depends_on`)**: []
> **Base**: dev
> **Dev tip**: `0f3467bd`
> **QC (מרדכי)**: תוקן אחרי peer-review — `bun.lock` הוא lockfile ה-active בסלייס; Commit 5 הוא phase-verifier.

---

## 🔍 §QC — הערות מרדכי (peer-review, 2026-07-11)

> **מקור:** בקרת-איכות של **מרדכי (planner)** על ה-brief הזה, כחלק מ**תיאום חוצה-סלייסים**
> (`slice-session-budget-meter` + `slice-subagent-nested-bubble`). **אלה לא ממצאי אביגיל ולא executor** —
> אביגיל נתנה READY r3 (נכון, מול הקוד); ההערות כאן הן על **קשרים בין-סלייסיים** ו**סתירה פנימית**
> שהן מחוץ לזווית-הבדיקה של אביגיל.
> **Codex** (מחבר ה-brief): אתה הבעלים. מרדכי מציע תיקונים; לא ערכתי את גוף ה-brief שלך.
> **סטטוס:** תוקן בגוף הבריף. #1 נפתר בבחירה חד-משמעית: `bun.lock` הוא source-of-truth לסלייס,
> ו-`pnpm-lock.yaml` מתועד כ-stale/deprecated עד החלטת package-manager נפרדת. #2 נוסף ל-Commit 3.
> #3 הודגש כ-phase verifier ל-Commit 5.

### 🔴 #1 — סתירת lockfiles: `bun install` לא מעדכן את `pnpm-lock.yaml`, אבל ה-DoD בודק אותו
ה-brief מתקין עם `bun install` (§0: pnpm לא זמין). אבל `bun` כותב רק ל-`bun.lock` ו**מתעלם מ-`pnpm-lock.yaml`** —
שיישאר קפוא על הגרסאות הישנות (`@agentclientprotocol/sdk@0.21.1` וכו'). ואילו **DoD #1/#2/#4/#6 + בדיקות Commit 2/6**
עושים `rg ... pnpm-lock.yaml` ומצפים לריק מגרסאות-ישנות → **ה-DoD ייכשל**, בסתירה לשורת-הסיכון §6 ("אם pnpm-lock
לא מתעדכן, תעד ש-bun.lock הפעיל"). בנוסף — סכנה שקטה: `pnpm install` עתידי (CI/מכונה אחרת) יקרא את ה-lock הישן
ויחזיר את הגרסאות הישנות.
> **הכרעה בגוף הבריף:** בוחרים (ב). לא מוחקים `pnpm-lock.yaml` בסלייס הזה, כדי לא להפוך upgrade ACP
> ל-migration package-manager רחב. כל בדיקות ה-DoD לגרסאות פעילות מצומצמות ל-`bun.lock` + manifests,
> ו-`pnpm-lock.yaml` מתועד כ-stale/deprecated ב-decision log עד סלייס package-manager ייעודי.

### 🟡 #2 — פער חוצה-סלייס: השדרוג ל-`claude-agent-sdk@0.3.207` לא מאמת את המתודה של session-budget
`slice-session-budget-meter` (READY, ממתין לרצף) נשען על `query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`
ב-SDK **0.3.206**. השדרוג עובר ל-**0.3.207**, וה-method הזה מסומן מפורשות "unstable — השם ישתנה כשיתייצב".
ה-brief לא בודק שהוא שרד את ה-bump (מובן — session-budget לא ב-scope של Codex; **זה תיאום של מרדכי**).
> **תיקון מוצע:** הוסף ל-DoD (או ל-Commit 3) בדיקת-שורה: `grep -c usage_EXPERIMENTAL <path>/claude-agent-sdk/sdk.d.ts`
> על **0.3.207** — ותעד את התוצאה. אם המתודה נעלמה/שונתה-שם → escalation למרדכי (משפיע על session-budget).

### 🟡 #3 — תלות-סמויה: Commit 5 הוא ה-gate שקובע אם `subagent-nested-bubble` שורד את המעבר ל-upstream
`subagent-nested-bubble` (Codex מאמת אותו **עכשיו**) נשען על **פורק** שמעביר transcript של תת-סוכן. השדרוג עובר ל-**upstream
`0.58.1`**, שלפי הטבלה שלך **"לא פותר subagent transcript"** → מעבר ל-upstream **ישבור את subagent-UI**, **אלא אם**
Commit 5 יוכיח ש-`emitRawSDKMessages` (שכן קיים ב-0.58.1) מספק את הפריימים כתחליף-לפורק.
> **המשמעות (לידיעת Codex):** Commit 5 הוא **ה-linchpin** של הרצף. אם ה-subagent-UI ימוזג על הפורק לפני השדרוג —
> השדרוג **חייב** ש-Commit 5 יעבור, אחרת ה-subagent-UI ייסוג. הצעה: **הַעֲלֵה את Commit 5 לתשומת-לב מוגברת**
> (verifier-phase), ו**התנֵה** את הסרת-הפורק/מעבר-upstream בהצלחתו (כבר משתקף ב-§2 "fork רק אם raw path נכשל" —
> רק להדגיש שזה gate-רצף, לא רק החלטה-פנימית).

> **סיכום מרדכי:** ההערות תוקנו בגוף הבריף; הסלייס מאושר לרצף.

---

## §0 — Pre-flight

> env קבוע (ports/OneCLI/tunnel/hooks/preview) → `AGENTS.md`. פרוטוקול executor גנרי → סוכן `eliezer`.
> כאן רק מה שספציפי ל-slice.

### תלויות (חובה!)

**אין תלויות** — נבנה ישירות על dev.

ה-slice נוגע בשכבת הפרוטוקול הבסיסית של כל הספקים. עבודה additive אינה מספיקה; זהו upgrade
של dependencies + lockfiles + containment של שכבות ACP. אל תערבב עם nested-subagent UI, quota-meter
או provider-abstraction. אלה משתמשים בתשתית הזאת אחר כך.

### תמונת מצב מאומתת (2026-07-11)

| רכיב | אצלנו | latest | הערה |
|---|---:|---:|---|
| `@agentclientprotocol/sdk` | `^0.21.1` | `1.2.1` | ה-client SDK הראשי בכל workspace |
| `acp-sdk-v1` alias | `@agentclientprotocol/sdk@1.0.0` | `1.2.1` | נוצר כדי להריץ Claude in-process; אמור להיעלם או להצטמצם |
| `@agentclientprotocol/claude-agent-acp` | `^0.52.0` | `0.58.1` | `0.58.1` פותר `background_tasks_changed`, לא פותר subagent transcript |
| `@anthropic-ai/claude-agent-sdk` | `^0.3.206` + root override `0.3.206` | `0.3.207` | שכבת ה-CLI/binary provider של Claude Agent SDK; חייבת להתעדכן יחד עם adapter |
| `@anthropic-ai/claude-code` | לא תלות ישירה | `2.1.207` | CLI standalone של Claude Code; לא להוסיף אם ה-adapter נשען על `claude-agent-sdk`, אבל לתעד אם נדרש |
| `@musicode1/codex-acp` | `1.0.2` | `1.0.2` | הפורק שלנו; תלוי `@agentclientprotocol/sdk@^1.1.0` ו-`@openai/codex@^0.142.5` |
| `@agentclientprotocol/codex-acp` | לא בשימוש runtime | `1.1.2` | current upstream package name; לבדוק אם יש `./lib`/in-process API לפני fallback לפורק |
| `@zed-industries/codex-acp` | לא בשימוש runtime | `0.16.0` | deprecated legacy package; reference בלבד, לא Gate ראשי |
| `@openai/codex` | דרך הפורק `^0.142.5` | `0.144.1` (`alpha` 0.145.0-alpha.4) | שכבת ה-CLI/binary provider של Codex; להשתמש ב-latest stable בלבד |

### פורקים מקומיים זמינים

הפורקים כבר נמצאים מקומית תחת `/home/user/Projects/drive-coding/sub-packages`. הם **לא** חלק
מ-`workspaces` של drive-coding (`workspaces: ["packages/*"]`), ולכן עובדים עליהם כריפואים עצמאיים.

| fork | נתיב | branch נקי שנבדק | מצב package מקומי |
|---|---|---|---|
| Claude | `/home/user/Projects/drive-coding/sub-packages/claude-agent-acp` | `main...origin/main` | `@agentclientprotocol/claude-agent-acp@0.48.0`, SDK `0.28.1`, Claude SDK `0.3.183` |
| Codex | `/home/user/Projects/drive-coding/sub-packages/codex-acp` | `main...origin/main` | `@agentclientprotocol/codex-acp@1.0.2`, SDK `^1.1.0`, Codex `^0.142.5` |

**השלכה לביצוע:** אל תחפש clone חיצוני חדש לפני שימוש בנתיבים האלה. כן מותר `git fetch upstream`
בתוך כל fork, אבל אל תעשה push/publish בלי אישור מפורש.

**Codex חשוב:** אל תתחיל את עבודת הפורק מ-`main`. ה-API ש-drive-coding צריך (`exports["./lib"]`,
`src/lib.ts`, ו-`startAcpServer(readable, writable, opts)`) נמצא ב-`origin/drive-coding`
וב-`origin/inprocess-lib`, שניהם ב-`96048dc7aef1abe56cdaa946108206e81ed3228d`. `main`
הוא רק upstream-style CLI ואינו מספיק ל-in-process embedding.

### Worktree

```bash
cd /home/user/Projects/drive-coding
git worktree add .worktrees/acp-stack-upgrade -b slice/acp-stack-upgrade dev
cd .worktrees/acp-stack-upgrade
bun install
bun run hooks:install
```

### Branches בפורקים המקומיים

אם צריך לשנות fork, צור branch מקומי בכל repo רלוונטי:

```bash
cd /home/user/Projects/drive-coding/sub-packages/claude-agent-acp
git switch -c slice/acp-stack-upgrade-claude

cd /home/user/Projects/drive-coding/sub-packages/codex-acp
git fetch origin upstream
git switch -c slice/acp-stack-upgrade-codex origin/drive-coding
```

אם branch כבר קיים, השתמש בו; אל תדרוס `main`. בפורק Codex מותר להשתמש גם
ב-`origin/inprocess-lib` כ-base, אבל אל תתחיל מ-`main`.

### איך להריץ

- install: `bun install` (בסביבה הנוכחית `pnpm` לא זמין; המשתמש אישר Bun כנתיב התקנה)
- typecheck מלא: `bun run typecheck`
- provider tests: `bun --filter @drive-coding/provider test`
- frontend tests: `bun --filter @drive-coding/frontend test`
- backend build/typecheck: `bun --filter @drive-coding/backend typecheck`
- BE חי: `cd packages/backend && PORT=4000 bun --watch src/server.ts`
- BE חי דרך OneCLI, רק אם `onecli` זמין: `cd packages/backend && PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts`
- FE חי: `bun --filter @drive-coding/frontend dev`

### Browser / Live agents

- Claude live smoke: צריך auth קיים של Claude Code במכונה.
- Codex live smoke: צריך `codex` זמין דרך `CODEX_PATH` או `resolveCodexPath()`; Windows path הוא חלק מה-DoD.
- Browser רק אם נדרש smoke דרך `/chat`; אין UI חדש בסלייס הזה.

### Reading list

**must-read**:
- `packages/provider/src/client/client.ts` + `client-impl.ts` — שימושי `ClientSideConnection`, `ndJsonStream`, `Client`.
- `packages/provider/src/connection/connect-in-process.ts` + `stream-bridge.ts` + `providers/claude/client-bridge.ts` — שימושי `agent`, `methods`, `RequestError`, `Stream`.
- `packages/provider/src/connection/connect-codex-in-process.ts` — למה Codex תלוי ב-`@musicode1/codex-acp/lib`.
- `/home/user/Projects/drive-coding/sub-packages/claude-agent-acp/package.json` + `src/acp-agent.ts` — fork מקומי ישן (`0.48.0`) שכבר מכיל `emitRawSDKMessages` ו-`task_*` cases.
- `/home/user/Projects/drive-coding/sub-packages/codex-acp` ב-`origin/drive-coding` — fork מקומי עם `exports["./lib"]`, `src/lib.ts`, ו-`startAcpServer(readable,writable,opts)`.
- `docs/decisions/drive-coding.md` סעיפי `codex-inprocess` ו-`claude-subagent-adapter-fork`.
- `docs/plans/slice-subagent-transcript-data.md` — רק כ-consumer עתידי; לא לממש כאן.

**reference**:
- npm registry latest שנבדק ב-2026-07-11:
  - `@agentclientprotocol/sdk@1.2.1`
  - `@agentclientprotocol/claude-agent-acp@0.58.1`
  - `@anthropic-ai/claude-agent-sdk@0.3.207`
  - `@anthropic-ai/claude-code@2.1.207` (reference בלבד; לא תלות ישירה אלא אם מתגלה צורך)
  - `@agentclientprotocol/codex-acp@1.1.2`
  - `@zed-industries/codex-acp@0.16.0`
  - `@openai/codex@0.144.1`

---

## §1 — מטרה

בסוף הסלייס drive-coding רץ על stack ACP עדכני ואחיד: client SDK `1.2.1`, Claude adapter `0.58.1`,
ו-Codex ACP מעודכן מול SDK/Codex stable האחרונים, בלי שלוש גרסאות ACP שונות באותו תהליך. אחרי השדרוג
אפשר להחליט על subagent transcript לפי `emitRawSDKMessages`/`forwardSubagentText` במקום להיתקע על fork ישן.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| שדרוג `@agentclientprotocol/sdk` בכל workspaces ל-`^1.2.1` | ✅ | הסלייס הזה |
| הסרה או איחוד של `acp-sdk-v1` alias | ✅ | הסלייס הזה |
| שדרוג `@agentclientprotocol/claude-agent-acp` ל-`^0.58.1` | ✅ | הסלייס הזה |
| שדרוג תלות ה-CLI של Claude: `@anthropic-ai/claude-agent-sdk` ל-`0.3.207` כולל root override | ✅ | הסלייס הזה |
| העברת `claude-agent-acp` ל-`dependencies` אם runtime import דורש זאת | ✅ | הסלייס הזה |
| בדיקה חיה ש-`background_tasks_changed` כבר לא מרעיש | ✅ | הסלייס הזה |
| בדיקה אם `command_lifecycle` עדיין מרעיש ב-`0.58.1` | ✅ | הסלייס הזה |
| בדיקה/הדלקה מבוקרת של `emitRawSDKMessages` כבסיס לביטול fork subagent | ✅ | spike קטן בסוף הסלייס |
| Codex: חזרה ל-upstream `@agentclientprotocol/codex-acp@1.1.2` אם יש `./lib` מתאים | ✅ | gate ראשון בסלייס הזה |
| Codex: בדיקת `@zed-industries/codex-acp@0.16.0` legacy רק אם צריך ראיית השוואה | ✅ | secondary reference בלבד |
| Codex: אם אין upstream lib, סנכרון הפורק המקומי `sub-packages/codex-acp` ל-SDK `^1.2.1` ו-`@openai/codex@^0.144.1` | ✅ | הסלייס הזה, repo מקומי |
| וידוא שתלות ה-CLI של Codex היא latest stable: `@openai/codex@^0.144.1` | ✅ | הסלייס הזה |
| nested subagent bubble data/render | ❌ | slice המשך אחרי upgrade |
| fork `claude-agent-acp` מחדש על `0.58.1` בתוך `sub-packages/claude-agent-acp` | ❌ | רק אם raw SDK path נכשל; slice המשך |
| מעבר מלא מ-`ClientSideConnection` ל-`client().connectWith()` | ❌ | future cleanup; כאן מותר להשאיר deprecated כדי לצמצם blast radius |
| שדרוג ל-`@openai/codex@alpha` | ❌ | לא בסלייס יציבות |

---

## §3 — Architecture diagram

```
Before:

FE/Core/Backend/Provider ── import @agentclientprotocol/sdk@0.21.1
Provider Claude bridge   ── import acp-sdk-v1 = @agentclientprotocol/sdk@1.0.0
Claude adapter           ── @agentclientprotocol/claude-agent-acp@0.52.0
                             └─ @anthropic-ai/claude-agent-sdk@0.3.206 override
Codex adapter            ── @musicode1/codex-acp@1.0.2
                             └─ @agentclientprotocol/sdk@1.1.0
                             └─ @openai/codex@0.142.x

After:

All drive-coding packages ── import @agentclientprotocol/sdk@1.2.1
Provider Claude bridge     ── import { agent, methods, RequestError, Stream } from same SDK
Claude adapter             ── @agentclientprotocol/claude-agent-acp@0.58.1
                              └─ @anthropic-ai/claude-agent-sdk@0.3.207 override
Codex adapter              ── either upstream @agentclientprotocol/codex-acp if ./lib exists
                              OR @musicode1/codex-acp@1.0.3+ synced to:
                                 @agentclientprotocol/sdk@1.2.1
                                 @openai/codex@0.144.1

Raw SDK spike:
ClaudeAcpAgent --extNotification("_claude/sdkMessage")--> FE #onExtNotification
```

---

## §4 — Commits בסדר

### Commit 0 — audit-lock: current ACP graph + package-manager baseline (approach: manual)

**קבצים חדשים/משתנים:**
- `docs/decisions/drive-coding.md` — entry קצר עם גרסאות current/latest והחלטת split.

**בדיקות:**
```bash
python3 - <<'PY'
import json, urllib.request
for pkg in [
  '@agentclientprotocol/sdk',
  '@agentclientprotocol/claude-agent-acp',
  '@anthropic-ai/claude-agent-sdk',
  '@anthropic-ai/claude-code',
  '@agentclientprotocol/codex-acp',
  '@musicode1/codex-acp',
  '@zed-industries/codex-acp',
  '@openai/codex',
]:
    url='https://registry.npmjs.org/'+pkg.replace('/','%2f')
    with urllib.request.urlopen(url, timeout=30) as r:
        data=json.load(r)
    print(pkg, data.get('dist-tags'))
PY
```

**DoD Commit 0:** decision log מכיל טבלה current/latest ותיעוד ש-`packageManager` עדיין מצהיר
`pnpm@10.0.0`, אבל בסביבת הביצוע הנוכחית `bun install` הוא נתיב ההתקנה המאושר.

---

### Commit 1 — client SDK: upgrade `@agentclientprotocol/sdk` to `^1.2.1` (approach: integration)

**קבצים שמשתנים:**
- `package.json` / workspace package manifests:
  - `packages/core/package.json`
  - `packages/frontend/package.json`
  - `packages/backend/package.json`
  - `packages/provider/package.json`
- `bun.lock`
- `pnpm-lock.yaml` לא נבדק כמקור אמת בסלייס הזה. אל תערוך ידנית; תעד ב-decision log שהוא stale/deprecated עד סלייס package-manager.

**פעולות:**
1. החלף כל `@agentclientprotocol/sdk: ^0.21.1` ל-`^1.2.1`.
2. הרץ `bun install`.
3. תקן type errors בלבד. אל תעשה migration ארכיטקטוני ל-`client().connectWith()` בסלייס הזה.

**נקודות קוד שצפויות להיות רגישות:**
- `packages/provider/src/client/client.ts` — `ClientSideConnection`, `ndJsonStream`.
- `packages/provider/src/client/client-impl.ts` — `Client` interface; ב-`1.2.1` חלק מה-methods מחזירים `MaybePromise`.
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — `SessionNotification`, `SessionConfigOption`, `SessionModeState`.
- `packages/core/src/ports.ts` — `PromptResponse`, `SessionNotification`.

**Verification:**
```bash
bun --filter @drive-coding/provider typecheck
bun --filter @drive-coding/frontend typecheck
bun --filter @drive-coding/backend typecheck
bun --filter @drive-coding/core typecheck
bun --filter @drive-coding/provider test
bun --filter @drive-coding/frontend test
```

**phase verifier:** אחרי Commit 1, לבדוק שאין import שנשאר על SDK ישן למעט dependency פנימי של חבילות צד שלישי.

---

### Commit 2 — remove `acp-sdk-v1` containment or re-alias it to `1.2.1` (approach: integration)

**ברירת מחדל:** להסיר את alias `acp-sdk-v1` ולהחליף imports ל-`@agentclientprotocol/sdk`, כי `1.2.1` כבר כולל:
`agent`, `client`, `methods`, `RequestError`, `Stream`, `AnyMessage`, `AgentContext`, `ClientContext`.

**קבצים שמשתנים:**
- `packages/provider/package.json` — הסר `acp-sdk-v1` אם אין צורך.
- `packages/provider/src/connection/connect-in-process.ts`
- `packages/provider/src/connection/stream-bridge.ts`
- `packages/provider/src/connection/stream-bridge.test.ts`
- `packages/provider/src/providers/claude/in-process-host.ts`
- `packages/provider/src/providers/claude/client-bridge.ts`

**Fallback מותר:** אם מחיקה מלאה יוצרת type break לא-טריוויאלי, השאר alias אבל עדכן:
```json
"acp-sdk-v1": "npm:@agentclientprotocol/sdk@1.2.1"
```
ותעד ב-`docs/decisions/drive-coding.md` למה alias נשאר זמנית.

**אסור:** להחזיק `0.21.1`, `1.0.0`, `1.2.1` יחד אחרי commit זה.

**Verification:**
```bash
rg '@agentclientprotocol/sdk@0.21.1|acp-sdk-v1.*1.0.0' bun.lock package.json packages
bun --filter @drive-coding/provider typecheck
bun --filter @drive-coding/provider test
```

---

### Commit 3 — Claude: upgrade adapter to `@agentclientprotocol/claude-agent-acp@^0.58.1` (approach: integration + live)

**קבצים שמשתנים:**
- root `package.json` — `pnpm.overrides` ו-`overrides` עבור `@anthropic-ai/claude-agent-sdk`.
- `packages/provider/package.json`
- `bun.lock`
- `packages/provider/src/connection/claude-env-override.ts` comments אם עדיין מזכירים `0.52.0`.

**קבצי reference מקומיים:**
- `/home/user/Projects/drive-coding/sub-packages/claude-agent-acp/package.json`
- `/home/user/Projects/drive-coding/sub-packages/claude-agent-acp/src/acp-agent.ts`

**חשוב:** הפורק המקומי של Claude כרגע ב-`0.48.0`, לא ב-`0.58.1`. ברירת המחדל של הסלייס
היא לצרוך npm upstream `@agentclientprotocol/claude-agent-acp@^0.58.1` ב-drive-coding, ולא להפנות
את drive-coding ל-fork המקומי. הפורק המקומי משמש reference ולבסוף base ל-fork חדש רק אם
Commit 5 מוכיח ש-raw SDK path לא מספיק.

**פעולות:**
1. עדכן `@agentclientprotocol/claude-agent-acp` ל-`^0.58.1`.
2. העבר מ-`devDependencies` ל-`dependencies` אם build/runtime מוכיח שה-package נדרש בזמן הרצת provider. הוא imported runtime ב:
   - `connect-in-process.ts`
   - `providers/claude/in-process-host.ts`
3. עדכן את תלות ה-CLI של Claude:
   - `packages/provider/package.json`: `@anthropic-ai/claude-agent-sdk` → `^0.3.207`.
   - root `package.json`: גם `pnpm.overrides` וגם `overrides` → `@anthropic-ai/claude-agent-sdk: "0.3.207"`.
   - תעד ש-`@anthropic-ai/claude-code@2.1.207` הוא ה-standalone CLI latest, אבל אל תוסיף אותו כתלות אם `claude-agent-acp` ממשיך להשתמש ב-`claude-agent-sdk` וה-smoke עובר.
4. אם `claude-agent-acp@0.58.1` נשבר בגלל override `0.3.207` מול התלות המוצהרת שלו, עצור ותעד escalation; אל תחזור אוטומטית ל-`0.3.205`/`0.3.206` בלי החלטה.
5. בדוק תאימות לסלייס `session-budget-meter`: ודא ש-`usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` עדיין קיים ב-`@anthropic-ai/claude-agent-sdk@0.3.207`. אם לא — escalation למרדכי לפני המשך, כי זה שובר את slice התקציב.

**בדיקות חיות:**
- session Claude קצר.
- בדוק tmux/logs: `background_tasks_changed` לא מופיע כ-`Unexpected case`.
- בדוק אם `command_lifecycle` עדיין מופיע. אם כן, תעד known residual; לא לתקן כאן אלא אם זה תיקון no-op קטן וברור.

**Verification:**
```bash
bun --filter @drive-coding/provider typecheck
bun --filter @drive-coding/provider test
bun --filter @drive-coding/provider test:live
rg 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET' node_modules/@anthropic-ai/claude-agent-sdk packages/provider/node_modules/@anthropic-ai/claude-agent-sdk
```

**phase verifier:** אחרי Commit 3, verifier בודק live Claude attach + prompt + no crash + log noise.

---

### Commit 4 — Codex: upstream-or-fork upgrade (approach: manual + integration + live)

**Gate A — האם upstream מספיק:**
בדוק קודם את ה-package הנוכחי `@agentclientprotocol/codex-acp@1.1.2`, מתוך workspace שבו
ה-dependency זמינה. אם היא עדיין לא נוספה ל-provider, בצע spike זמני בלבד ותעד את הפקודה.

```bash
cd packages/provider
node -e "import('@agentclientprotocol/codex-acp/lib').then(m=>console.log(typeof m.startAcpServer)).catch(e=>{console.error(e.message); process.exit(1)})"
```

אם יש `startAcpServer(readable,writable,opts)` תואם:
- החלף `@musicode1/codex-acp` ב-`@agentclientprotocol/codex-acp@^1.1.2`.
- עדכן import ב-`connect-codex-in-process.ts`.
- מחק ambient declaration אם upstream מספק types.

אם `@agentclientprotocol/codex-acp@1.1.2` אינו מספק `./lib`, מותר לבדוק את
`@zed-industries/codex-acp@0.16.0` כראיית legacy בלבד. אל תחזור אליו אם הוא deprecated או bin-only.

אם אין `./lib` תואם (**ברירת מחדל צפויה**):
- השתמש ב-fork המקומי `/home/user/Projects/drive-coding/sub-packages/codex-acp`; אל תיצור clone חדש.
- צור בו branch `slice/acp-stack-upgrade-codex` מ-`origin/drive-coding` אם עוד אין branch מתאים:
  `git switch -c slice/acp-stack-upgrade-codex origin/drive-coding`.
- אמת ש-`src/lib.ts`, `exports["./lib"]`, ו-`startAcpServer(readable,writable,opts)` קיימים לפני שינוי גרסאות.
- סנכרן אותו מול `upstream` הרלוונטי.
- עדכן בפורק:
  - `@agentclientprotocol/sdk` → `^1.2.1`
  - `@openai/codex` → `^0.144.1` (**זאת תלות ה-CLI עצמו; חובה לוודא ב-lock וב-runtime**)
  - `prepare`/`build` נשארים.
  - שמור export `./lib` ו-`startAcpServer`.
- הכרעת package name:
  - drive-coding כרגע צורך `@musicode1/codex-acp/lib`.
  - הפורק המקומי כרגע מצהיר `"name": "@agentclientprotocol/codex-acp"`.
  - אל תשאיר mismatch שדורש ambient declaration שקרי. או שנה את שם החבילה המקומית ל-`@musicode1/codex-acp` לפני publish/git consume, או שנה את drive-coding לצרוך את שם החבילה החדש ותעד למה.
- הרץ tests/build בפורק.
- הכן publish ל-`@musicode1/codex-acp@1.0.3` או צרוך SHA git מפורש אם publish לא מאושר/לא זמין.
  אל תעשה `npm publish` בלי אישור מרדכי/המשתמש.
- עדכן drive-coding dependency.

**קבצים ב-drive-coding שמשתנים:**
- `packages/provider/package.json`
- `packages/backend/src/vendor.d.ts` — עדכן או מחק לפי מצב types.
- `packages/provider/src/connection/connect-codex-in-process.ts` — רק אם import/options השתנו.
- `bun.lock`

**Codex live verification:**
- ודא `resolveCodexPath()` מוצא Codex.
- פתח session codex, prompt קצר, turn מסתיים.
- כבה agent; ודא אין codex child יתום.
- Windows path behavior לא נשבר: בדיקה סטטית ל-knownPaths + אם יש מכונת Windows זמינה, smoke חי.

**Verification:**
```bash
bun --filter @drive-coding/provider typecheck
bun --filter @drive-coding/provider test
bun --filter @drive-coding/backend typecheck
```

**phase verifier:** אחרי Commit 4, verifier בודק במיוחד שאין regressions ב-`connectCodexInProcess.close()`.

---

### Commit 5 — raw SDK spike: can `emitRawSDKMessages` replace Claude fork? (approach: manual + unit)

**מטרה:** לא לממש nested bubble. רק להכריע אם fork Claude עדיין נחוץ אחרי upgrade.

**קבצים שמשתנים:**
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts`
- אולי `packages/provider/src/connection/connect-in-process.ts` אם ה-meta מוזרק בצד provider במקום FE.
- tests רלוונטיים ל-ext notification.

**פעולות:**
1. הרחב `CLAUDE_SESSION_META` כך שיכלול:
```ts
claudeCode: {
  options: {
    thinking: { type: "adaptive", display: "summarized" },
    forwardSubagentText: true,
  },
  emitRawSDKMessages: [
    { type: "system", subtype: "task_started" },
    { type: "system", subtype: "task_progress" },
    { type: "system", subtype: "task_notification" },
    { type: "system", subtype: "task_updated" },
    { type: "assistant" },
  ],
}
```
2. הוסף ב-`#onExtNotification` logging/test hook זמני או state פנימי מינימלי שסופר `_claude/sdkMessage`.
3. הרץ live Task/subagent קצר.
4. תעד:
   - האם raw `task_*` מגיעים לפני שה-adapter עושה `break`.
   - האם assistant subagent עם `parent_tool_use_id` מגיע למרות filter.
   - האם `forwardSubagentText` גורם text/thinking לזרום ב-query mode.

**DoD Commit 5:**
- `docs/decisions/drive-coding.md` מקבל הכרעה:
  - `fork-not-needed-for-transcript` — אם raw path מספיק.
  - או `fork-still-needed` — עם הסיבה המדויקת.
- phase verifier אחרי Commit 5: כלב בודק ש-raw SDK gate אכן מוכיח או דוחה את ביטול fork בלי להניח מסקנה מראש.

**לא לעשות כאן:** לא לבנות `subFrames`, לא UI, לא normalize מלא.

---

### Commit 6 — cleanup + docs + lock consistency (approach: manual)

**קבצים שמשתנים:**
- `docs/walkthrough.md`
- `docs/decisions/drive-coding.md`
- lockfiles לפי package manager בפועל.

**בדיקות סופיות:**
```bash
rg '@agentclientprotocol/sdk@0.21.1|@agentclientprotocol/sdk@1.0.0|claude-agent-acp@0.52.0|@openai/codex@0.142' bun.lock packages package.json
rg '@anthropic-ai/claude-agent-sdk.*0\\.3\\.20[0-6]|@openai/codex.*0\\.142' bun.lock package.json packages /home/user/Projects/drive-coding/sub-packages
bun run typecheck
bun --filter @drive-coding/provider test
bun --filter @drive-coding/frontend test
bun --filter @drive-coding/backend typecheck
```

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|------|------|
| 1 | client SDK הראשי `1.2.1` | `rg '@agentclientprotocol/sdk\".*0\\.21\\.1|@agentclientprotocol/sdk@0\\.21\\.1' packages bun.lock` מחזיר ריק |
| 2 | אין alias תקוע על `1.0.0` | `rg 'acp-sdk-v1.*1\\.0\\.0|@agentclientprotocol/sdk@1\\.0\\.0' package.json packages bun.lock` מחזיר ריק |
| 3 | Claude adapter `0.58.1` | מתוך `packages/provider`: `node -e "import('@agentclientprotocol/claude-agent-acp').then(()=>console.log('ok'))"` |
| 4 | Claude CLI provider מעודכן | lockfile ו-root override מכילים `@anthropic-ai/claude-agent-sdk@0.3.207`, ולא `0.3.206` |
| 4b | session-budget compatibility | `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` קיים ב-`@anthropic-ai/claude-agent-sdk@0.3.207` |
| 5 | Codex wrapper מעודכן | או upstream `@agentclientprotocol/codex-acp@1.1.2` עם `./lib`, או `@musicode1/codex-acp@1.0.3+` עם SDK `1.2.1` ו-Codex `0.144.1` |
| 6 | Codex CLI provider מעודכן | הפורק/lock מכילים `@openai/codex@0.144.1`, ולא `0.142.x` |
| 7 | Typecheck מלא | `bun run typecheck` |
| 8 | Provider tests | `bun --filter @drive-coding/provider test` |
| 9 | Frontend tests | `bun --filter @drive-coding/frontend test` |
| 10 | Claude live smoke | prompt קצר; אין crash; `background_tasks_changed` לא כ-`Unexpected case` |
| 11 | Codex live smoke | prompt קצר; close מנקה child; אין `Already initialized` regression |
| 12 | Fork decision | decision log מכריע אם raw SDK מבטל את הצורך ב-Claude fork |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|------|------|----------|
| שינוי schema בין ACP `0.21.1` ל-`1.2.1` | jump גדול | Commit 1 בנפרד, typecheck לפי package, לא לערבב עם Claude/Codex |
| שלוש גרסאות SDK נשארות בלוק | מצב נוכחי | Commit 2 כולל `rg` חובה על `0.21.1`/`1.0.0` |
| `ClientSideConnection` deprecated | SDK `1.2.1` | לא לעשות migration בסלייס; רק לוודא עובד. cleanup עתידי |
| Claude adapter `0.58.1` עדיין מסנן subagent | בדיקה קודמה | Commit 5 בודק raw SDK path; לא להחזיר fork בלי ראיה |
| `command_lifecycle` עדיין noisy | `0.58.1` לא מכיל case | תעד residual; תיקון no-op נפרד אם צריך |
| Codex upstream לא מספק `./lib` | הצורך שלנו ב-in-process | Gate A על `@agentclientprotocol/codex-acp@1.1.2`; אם אין, ממשיכים עם fork מסונכרן |
| `@openai/codex` alpha מפתה | registry מציע alpha | רק `latest` stable `0.144.1`, לא alpha |
| Claude CLI provider skew | `claude-agent-acp@0.58.1` מצהיר `claude-agent-sdk@0.3.205`, אבל latest הוא `0.3.207` | root override ל-`0.3.207` + live smoke; escalation אם נשבר |
| `pnpm-lock.yaml` stale מול `bun.lock` | פרויקט היסטורי עבר בין כלים | install מאושר = `bun install`; `bun.lock` הוא source-of-truth בסלייס, ו-`pnpm-lock.yaml` מתועד כ-stale/deprecated עד סלייס package-manager |
| runtime dep מסווג כ-devDep | `claude-agent-acp` imported runtime | Commit 3 בודק ומעביר ל-`dependencies` אם צריך |

---

## §7 — Escalation triggers

עצור ושאל את מרדכי אם:

- `@agentclientprotocol/sdk@1.2.1` משנה signature שמצריך מעבר מלא ל-`client().connectWith()`.
- הסרת `acp-sdk-v1` דורשת refactor רחב מ-3 קבצים.
- `claude-agent-acp@0.58.1` לא עובד עם override `@anthropic-ai/claude-agent-sdk@0.3.207`.
- upstream Codex `@agentclientprotocol/codex-acp@1.1.2` לא מספק `./lib`, והפורק המקומי לא ניתן לסנכרון או לצריכה כ-git/package.
- Codex fork branch `origin/drive-coding`/`origin/inprocess-lib` אינו זמין או לא מכיל `src/lib.ts`.
- הפורק המקומי של Codex נשאר בשם `@agentclientprotocol/codex-acp` אבל drive-coding ממשיך לייבא `@musicode1/codex-acp/lib`.
- Codex live smoke משאיר child יתום אחרי `close()`.
- raw SDK messages לא מגיעים דרך `_claude/sdkMessage` למרות `emitRawSDKMessages`.
- צריך לשנות wire protocol BE↔FE מעבר ל-ext notification קיים.

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|------|------|
| >5 files ב->2 packages | +1 |
| Protocol/core dependency upgrade | +2 |
| שני adapters חיצוניים (Claude + Codex) | +2 |
| Live agent smoke required | +1 |
| Cross-repo Codex fork אפשרי | +2 |
| No new UI | -1 |
| Commits מופרדים עם typecheck gates | -1 |

**Score**: 8/10

**Tier**: `verifier-slice-heavy`.

**Verifier-phase אחרי commits**:
- Commit 1 — SDK client upgrade.
- Commit 3 — Claude adapter live.
- Commit 4 — Codex adapter live.
- Commit 5 — raw SDK / subagent fork-decision gate.

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | האם למחוק `acp-sdk-v1` לגמרי או להשאיר alias ל-`1.2.1`? | למחוק אם typecheck מאפשר; אחרת alias זמני ל-`1.2.1` | ❌ |
| 2 | האם `claude-agent-acp` עובר ל-`dependencies`? | כן, כי הוא runtime import | ❌ |
| 3 | האם לחזור ל-upstream Codex? | רק אם `@agentclientprotocol/codex-acp@1.1.2` מכיל `./lib.startAcpServer` תואם | ✅ ב-Commit 4 |
| 4 | האם root override של `@anthropic-ai/claude-agent-sdk` נשאר? | כן, אבל לעדכן ל-`0.3.207`; להסיר רק אם `0.58.1` מתכנס לבד ל-latest וה-lock נשאר אחיד | ❌ |
| 5 | האם raw SDK path מבטל את Claude fork? | כן אם live smoke מוכיח `task_*` + assistant parent frames מגיעים | ❌ |

---

## סטיות מהתכנון (מתעדכן ע"י executor תוך כדי)

- ...
