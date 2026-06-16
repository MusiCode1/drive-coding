# Provider selection — providerId נפרד מ-cliKind

## 2026-06-13 — מודל בחירת-הספק כשמוסיפים claude-code (stream-json) מעל ה-CliKind הקיים

### רקע

עד היום ב-drive-coding כל בחירת-הספק היא ציר אחד: `CliKind` — `CLI_SPECS`
([`agent.ts:30-44`](../../packages/core/src/schemas/agent.ts#L30-L44)) + ה-enum
([`agent.ts:50`](../../packages/core/src/schemas/agent.ts#L50)), 5 ערכים
(`opencode`/`claude`/`gemini`/`codex`/`qoder`), **וכולם ACP**. גם `claude`
היום = `@agentclientprotocol/claude-agent-acp` (ACP wrapper), לא stream-json. כל ה-I/O דבוק ל-ACP:
`WsAcpTransport` → `createAcpClient` → `SessionNotification`.

`provider-contract` (= הריפו `provider-abstraction`) מביא את **claude-code stream-json**
(= ClaudeCodeACP) כספק ה**ראשון שאינו-ACP**, מאחורי `ProviderRegistry.create(providerId, cfg)`.
ברגע שיש שני פרוטוקולים, ה-`CliKind` הנוכחי מערבב שני צירים שעד היום נראו כאחד:

1. **איזה adapter/protocol** → `providerId`
2. **איזה CLI** (רלוונטי רק תחת ACP) → `opencode`/`gemini`/...

ובמיוחד: `claude` עמום — שני נתיבים לאותו מודל (ACP wrapper מול stream-json ישיר).

### ההכרעה

**`providerId` שדה נפרד מ-`cliKind`** — לא enum שטוח מורחב ולא מזהה מורכב (`acp:opencode`).

```ts
ProviderConfig {
  providerId: "acp" | "claude-code"          // = ה-id ל-registry.create()
  cliKind?: "opencode" | "gemini" | "codex" | "qoder" | "claude-acp"  // רק כש providerId="acp"
  cwd, modelOverride, ...
}
```

- `providerId="acp"` + `cliKind` → Claude/opencode/gemini/codex/qoder דרך ACP. ה-`cliKind` מזין את
  `CLI_SPECS` ([`cli-config.ts`](../../packages/backend/src/acp/cli-config.ts)) שבונה את ה-spawn,
  וה-consumer מעביר `cfg.transport` (`WsAcpTransport`) ל-registry.
- `providerId="claude-code"` → Claude דרך stream-json. **transport פנימי** (ה-adapter spawns בעצמו),
  אין `cliKind`.

> **למה לא מודל שטוח / מזהה מורכב**: `provider-contract` כבר מדבר `create(providerId, cfg)` עם
> `providerId ∈ {acp, claude-code}` בלבד (framework §4, P0-reg §3). ה-`cliKind` **נשאר ב-consumer**
> כחלק מ-CLI_SPECS (framework §8 #5) — הוא לא צריך להגיע ל-registry כ-id. שני שדות נפרדים ממפים
> 1:1 לחלוקת-האחריות הזו, בלי parsing של מזהה מורכב ובלי לערבב protocol+CLI בשדה אחד.

### naming — claude הכפול מובחן בשמות

| נתיב | מודל | שם | רובד |
|---|---|---|---|
| ACP wrapper (`@agentclientprotocol/claude-agent-acp`) | Claude | `claude-acp` | **cliKind** (תחת `providerId=acp`) |
| stream-json ישיר (ClaudeCodeACP) | Claude | `claude-code` | **providerId** (פרוטוקול נפרד) |

ה-`claude` הקיים ב-`CliKind` **משתנה שם** ל-`claude-acp`. הא-סימטריה (אחד cliKind, אחד providerId)
משקפת מציאות: `claude-acp` הוא עוד CLI מאחורי אותו ACP; `claude-code` הוא באמת פרוטוקול אחר.
שניהם דו-קיום — המשתמש בוחר, בלי שם עמום.

### enabler — ה-bridge כבר protocol-agnostic

ה-BE bridge ([`ws-agent.ts:87-118`](../../packages/backend/src/delivery/ws-agent.ts#L87-L118)) הוא
**NDJSON line-pump**: `child.stdout` (שורות) → feWs, ו-feWs → `child.stdin`. claude-code stream-json
**גם הוא NDJSON** → אותו bridge עובד לשני הספקים **ללא שינוי**. ההבדל היחיד: ה-spawn-spec (bin/args)
וה-parser בצד ה-frontend (`AcpProviderSession` מול `ClaudeCodeSession`). זה מוריד סיכון משמעותי
מ-slice ה-cutover.

### השלכות מימוש (ל-slices עתידיים — לא נחתם כאן)

1. **CLI_SPECS** מורחב: `claude` → `claude-acp` (rename), ו-spawn-spec ל-claude-code (stream-json flags)
   נכנס בצד ה-`providerId=claude-code` (לא כ-cliKind).
2. **UI** two-step: `[Provider ▾]` → אם `acp` אז `[CLI ▾]`. (היום dropdown יחיד של CliKind.)
3. **migration** ל-localStorage: persisted `cliKind="claude"` → `{ providerId:"acp", cliKind:"claude-acp" }`.
   ערכי ACP אחרים → `providerId:"acp"` + אותו cliKind.
4. **default**: `providerId="acp"`, `cliKind="opencode"` (שמירה על ברירת-המחדל הנוכחית).

### רעיונות שנדחו

- **CliKind שטוח מורחב** (`...|"claude-acp"|"claude-code"`) — נדחה: מערבב protocol+CLI בשדה אחד;
  ה-registry נאלץ למפות kind→adapter פנימית, בניגוד ל-`create(providerId)` הנקי.
- **providerId מורכב** (`"acp:opencode"`) — נדחה: דורש parse של המזהה; ה-cliKind ממילא נשאר ב-consumer,
  אז אין סיבה לקודד אותו לתוך ה-providerId שעובר ל-registry.

### Open (לבירור ב-slice claude-code integration)

- `ClaudeCodeSession` של ClaudeCodeACP — האם ה-stdio transport שלו רץ ב-frontend מעל ה-ws-bytes
  (כמו `WsAcpTransport`), או מצפה ל-child ישיר. פרט מימוש, לא חוסם את מודל-הבחירה.

### מקור

מיפוי `Explore` על dev (2026-06-13): `CLI_SPECS` ב-`agent.ts:30-51`, selection ב-FE
`settings.svelte.ts` + `+page.svelte`, spawn ב-`bridge-manager.ts`/`cli-config.ts`, bridge ב-`ws-agent.ts`.
תואם `provider-abstraction/docs/design/provider-contract-framework.md` §4/§8 + `slice-P0-reg-registry.md`.
