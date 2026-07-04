# הרצה ובדיקה מקומית (Local Run & Serve)

מדריך מעשי להרצת drive-coding מקומית לצורך פיתוח ואימות חי. למי שמחפש את
הפריסה הקבועה (systemd על cli-agents) — ראה [`deploy-local-service.md`](deploy-local-service.md).

---

## ⚠️ HTTPS חובה — הפרויקט לא עובד על HTTP

ה-FE משתמש ב-Web APIs שזמינים **רק ב-secure context** (`getUserMedia`/מיקרופון,
`AudioWorklet`, ועוד). דפדפנים חוסמים אותם על `http://` — פרט ל-`http://localhost`
שנחשב secure. לכן:

- **גישה מקומית מאותה מכונה** דרך `http://localhost:<port>` — עובדת (localhost = secure).
- **גישה מדומיין חיצוני / ממכשיר אחר** — **חייבת HTTPS**. בפועל דרך tunnel
  (`cloudflared` או `tuns.sh`), שנותן `https://…`. גישה ב-`http://` חיצוני תיכשל
  בשקט על המיקרופון/הקול.

`vite.config.ts` → `server.allowedHosts` כבר מתיר `.tuns.sh`, `.trycloudflare.com`
ו-`localhost`. הוסף שם דומיין חדש אם נדרש.

---

## שתי דרכים להריץ

### א. Dev (Vite) — לפיתוח שוטף

```bash
# BE (API/WS/proxy בלבד — Vite מגיש את ה-FE)
cd packages/backend
PORT=4000 bun src/server.ts          # ראה "חסמי Windows" לגבי onecli

# FE (Vite dev, port OS-assigned, מדפיס בהפעלה; ברירת מחדל 5173)
pnpm --filter @drive-coding/frontend dev
```

ב-dev, Vite עושה proxy ל-`/api`, `/proxy`, `/ws` → BE (port 4000, או `BE_PORT`).
ה-`server.proxy` ב-`vite.config.ts` חל **רק** על dev server (לא על `vite preview`).

### ב. Production-like (build + BE מגיש static) — מומלץ לאימות חי

Vite dev לא תמיד נאמן ל-prod (במיוחד עם tunnels ו-WebSocket). לאימות אמיתי בנה
והגש דרך ה-BE על **אותו origin**:

```bash
# 1. build → static ב-packages/frontend/build (adapter-static, SPA fallback)
pnpm --filter @drive-coding/frontend build

# 2. BE שמגיש גם את ה-static — same-origin, ללא proxy
cd packages/backend
FE_STATIC_DIR="<abs-path>/packages/frontend/build" PORT=4000 bun src/server.ts

# 3. tunnel HTTPS אל ה-BE (לא אל Vite)
cloudflared tunnel --url http://localhost:4000
# → https://<random>.trycloudflare.com
```

#### tunnel עם subdomain קבוע (tuns.sh) — לבדיקת Mic/mobile

כשצריך URL יציב (לא random) לבדיקת Mic (HTTPS חובה) או ממכשיר נייד:

```bash
ssh -i ~/.ssh/pico \
  -o StrictHostKeyChecking=accept-new \
  -o ServerAliveInterval=15 \
  -R drive-coding:80:localhost:<vite-port> tuns.sh http
```

URL: `https://your-app.tuns.sh`

⚠️ **אל תהרוג tunnel שמרדכי הפעילה** — היא משתמשת בו לבדיקות. אם צריך tunnel נפרד
ל-slice, השתמש בשם אחר → subdomain נפרד: `-R drive-coding-<slice>:80:...`.

ב-mode הזה `/api`, `/proxy`, `/ws` וה-FE כולם על origin אחד (4000) — בדיוק כמו
הפריסה הקבועה. זה הנתיב המועדף לבדוק התנהגות WS (כולל ה-heartbeat `$/ping`/`$/pong`).

#### Source maps (לדיבוג ה-build המוקטן)

ה-build מוקטן וה-chunks hashed (`DFDqgTZT.js`), כך שאי אפשר למפות `[Violation]`/stack
חזרה למקור. כדי לקבל source maps, בנה עם `FE_SOURCEMAP=true`:

```bash
FE_SOURCEMAP=true pnpm --filter @drive-coding/frontend build
```

`vite.config.ts` → `build.sourcemap` מבוקר ע"י ה-env הזה. בפריסת **dev/staging**
הוא מופעל קבוע ([`deploy/systemd/voice-acp-dev.service`](../deploy/systemd/voice-acp-dev.service)
מגדיר `FE_SOURCEMAP=true`); ב-**main/prod** הוא כבוי — כדי לא לשלוח source maps
פומביים ולא לנפח את ה-build.

#### איך הגשת ה-static עובדת בקוד

[`packages/backend/src/server.ts`](../packages/backend/src/server.ts) — הבלוק מותנה
ב-`FE_STATIC_DIR`: כשהוא מוגדר, ה-BE מגיש assets + SPA fallback ל-`index.html`
(נרשם **אחרי** כל route של `/api`,`/proxy` כדי לא להאפיל עליהם). כשלא מוגדר (dev),
Vite מגיש וה-BE נשאר API/WS/proxy בלבד.

---

## חסמים ידועים ב-Windows + עקיפות

ראה גם memory `e2e-on-windows-blockers`.

1. **`onecli run -- bun` נכשל ב-Windows** → `"could not start bun: not supported by windows"`.
   **עקיפה:** הרץ BE ישירות `bun src/server.ts` (ללא onecli). ה-gateway של onecli
   נחוץ **רק** ל-proxy של TTS (ElevenLabs/Google) — בלעדיו קריאות `/proxy/*` יחזירו
   401/400, אבל חיבור ה-LLM (claude) עובד דרך auth מקומי, וה-WS/ACP/session תקינים.

2. **opencode 1.2.27 קורס על הזרקת plugin** (tuple format ב-`OPENCODE_CONFIG_CONTENT`)
   → child קורס → "ACP connection closed". **עקיפה:** השתמש ב-**CLI=claude** לאימות
   חי. (claude/gemini/codex לא מושפעים — ההזרקה מותנית `cliKind==="opencode"`.)

3. **cwd validation** (`packages/core/src/cwd-validate.ts`) — תוקן: מקבל נתיבי
   Windows drive (`C:\`/`C:/`) ו-UNC דרך `WINDOWS_DRIVE_RE`. אין צורך בעקיפה.

---

## בדיקה מהירה שהכל עלה

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/            # FE (200)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/api/agents  # BE  (200)
```
