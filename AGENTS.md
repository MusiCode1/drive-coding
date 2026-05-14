# AGENTS.md — voice-acp

## מטרת הפרויקט

ממשק שיחה קולי ל-OpenCode דרך פרוטוקול ACP.
קרא את `docs/spec.md` לפני כל עבודה — הוא מקור האמת הטכני.

## מבנה הפרויקט

```
voice-acp/
├── backend/          # שרת Bun
│   ├── src/
│   │   ├── server.ts       # WebSocket server + HTTP endpoints
│   │   ├── acp-bridge.ts   # גישור WebSocket ↔ opencode acp (stdin/stdout)
│   │   ├── stt.ts          # Gemini STT (אודיו → טקסט)
│   │   └── tts.ts          # ElevenLabs TTS (טקסט → MP3)
│   ├── package.json
│   └── .env.example
├── frontend/
│   └── index.html    # דף HTML יחיד, vanilla JS, ללא build step
└── docs/
    └── spec.md       # מפרט טכני מלא — מקור האמת
```

## סביבה

**Runtime:** Bun (backend), ללא framework (frontend — HTML/JS בלבד)

**משתני סביבה נדרשים** (מוגדרים דרך 1CLI, לא קובץ `.env`):
- `GEMINI_API_KEY` — ל-STT
- `ELEVENLABS_API_KEY` — ל-TTS
- `ELEVENLABS_VOICE_ID` — מזהה הקול הרצוי

**אין pip, אין npm בpATH ישיר** — להשתמש ב-Bun בלבד לbackend.

## פקודות

```bash
# התקנת תלויות
cd backend && bun install

# הפעלת dev server (hot reload)
cd backend && bun run dev

# פתיחת ממשק (אחרי שהbackend רץ)
open frontend/index.html
# או: http://localhost:3000 (אם מוגש מהbackend)
```

## חוקי עבודה

1. **Frontend** — HTML בודד בלבד. אין build step, אין framework, אין bundler.
   הכל vanilla JS + Web APIs (MediaRecorder, WebSocket, Audio).
2. **Backend** — Bun native WebSocket. אין Express/Hono/Elysia לPOC.
3. **ACP** — `opencode acp` רץ כ-child process של הbackend.
   הbackend הוא ה-ACP **client**, opencode הוא ה-ACP **agent**.
4. **STT/TTS** — קריאות HTTP ישירות ל-Gemini ו-ElevenLabs מהbackend בלבד.
   המפתחות לא נחשפים לbrowser.
5. **Session** — פרמטרים `cwd` ו`session` מגיעים מ-URL params של הfrontend.
   הfrontend שולח אותם לbackend בהודעת `init`.
6. **אין לבנות feature מחוץ ל-spec** — הPOC הוא minimal בכוונה.

## פרוטוקול WebSocket (תקציר)

ראה `docs/spec.md` לתיאור מלא. בקצרה:

```
Client → Server: { type: "init", cwd, sessionId? }
Client → Server: { type: "audio", data: "<base64 wav/webm>" }
Client → Server: { type: "cancel" }

Server → Client: { type: "thinking" }          # STT הסתיים, ממתין למודל
Server → Client: { type: "text_chunk", text }  # תשובת המודל (streaming)
Server → Client: { type: "audio_chunk", data } # MP3 base64 מElevenLabs
Server → Client: { type: "done" }
Server → Client: { type: "error", message }
```

## תלויות Backend

```json
{
  "@agentclientprotocol/sdk": "^0.16.1",
  "@google/genai": "latest"
}
```

ElevenLabs — קריאות REST ישירות, ללא SDK (פשוט יותר לPOC).

## פרוטוקול עבודה מקבילית עם סוכנים אחרים

אם הסשן שלך הוא חלק מצוות סוכנים מקבילי (יש סוכן מתכנן/מבצע אחר פעיל), חובה לעבוד לפי הפרוטוקול ב-`docs/agents/README.md`. תקציר:

1. **בודקים worktree** — לפני שנוגעים בקוד, לוודא שאני ב-worktree משלי (`git worktree list`). אם לא, להעביר בקשה ל-Avi לפתוח כזה.
2. **קוראים את כל הקבצים ב-`docs/agents/`** — לראות מי פעיל, מה הוא עושה, ואם יש שאלה פתוחה אלי.
3. **כל סוכן כותב רק לקובץ שלו**: מתכנן → `planner.md`, מבצע → `executor.md`. **אין כתיבה משותפת**.
4. **תחילת סשן** — עדכון "מצב נוכחי" שלי בקובץ שלי + ערך לוג חדש "התחלתי סשן".
5. **שאלה לסוכן אחר** — לכתוב בקובץ שלי בלבד עם הסימן ❓. הסוכן השני יענה בקובץ שלו עם ✅.
6. **כשממתינים לתשובה** — לא להישאר בטלים. לעבוד על משימות אחרות שלא תלויות בתשובה. רק אם אין משימות עצמאיות זמינות — לעצור עם סטטוס "בהפסקה".
7. **לא להמציא ארכיטקטורה** — אם משהו בתוכנית חסר/מעורפל, לא לפתור אותו מיוזמתי בדרך שתשנה את הסקופ. לכתוב שאלה ולהמשיך.
8. **סיום סשן** — עדכון סטטוס ל"סיים" + ערך לוג "סיימתי. הצעדים הבאים: X".

## נקודות בדיקה (Definition of Done ל-POC)

- [ ] לחיצה על כפתור מתחילה הקלטה (אינדיקציה ויזואלית)
- [ ] שחרור הכפתור שולח את האודיו לbackend
- [ ] ה-STT מחזיר טקסט (מוצג בממשק לבדיקה)
- [ ] הטקסט נשלח לOpenCode דרך ACP
- [ ] התשובה מוקראת בקול (ElevenLabs)
- [ ] בזמן המתנה מושמע צליל "חושב"
- [ ] URL params `cwd` ו`session` נטענים בהצלחה
