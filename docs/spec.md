# מפרט טכני — voice-acp

> מקור האמת של הפרויקט. לעדכן בכל שינוי ארכיטקטורלי.

---

## 1. סקירה כללית

ממשק push-to-talk קולי ל-OpenCode דרך פרוטוקול ACP.
המשתמש לוחץ כפתור כדי להתחיל לדבר, לוחץ שוב כדי לסיים.
אין VAD.

### זרימה בסיסית

```
[לחץ] → MediaRecorder → [שחרר] → WebSocket → Backend
                                                  ↓
                                          Gemini STT (אודיו → טקסט)
                                                  ↓
                                     opencode acp (ACP, stdin/stdout)
                                                  ↓
                                       ElevenLabs TTS (טקסט → MP3)
                                                  ↓
                                        WebSocket → Frontend → Audio.play()
```

---

## 2. ארכיטקטורה

```
┌─────────────────────────────────┐
│  frontend/index.html            │
│  (Vanilla JS, ללא build)        │
│                                 │
│  - כפתור push-to-talk           │
│  - MediaRecorder (WebM/Opus)    │
│  - WebSocket client             │
│  - Audio playback               │
└────────────┬────────────────────┘
             │ WebSocket (ws://localhost:3000)
┌────────────▼────────────────────┐
│  backend/src/server.ts          │
│  (Bun native WebSocket)         │
│                                 │
│  - HTTP: GET /  → index.html   │
│  - WS handler                   │
│  - קריאות ל-Gemini STT          │
│  - קריאות ל-ElevenLabs TTS      │
│  - ACP bridge                   │
└────────────┬────────────────────┘
             │ stdin/stdout (ndJSON)
┌────────────▼────────────────────┐
│  opencode acp --cwd <workspace> │
│  (Child process)                │
│  @agentclientprotocol/sdk       │
└─────────────────────────────────┘
```

### עיקרון חשוב: Backend הוא ACP Client

הbackend הוא **ACP Client** — הוא spawns את opencode כ-child process ומחבר
אליו דרך `ClientSideConnection` מה-SDK. OpenCode הוא ה-**ACP Agent**.

---

## 3. ספריות

### Backend

| ספרייה | גרסה | שימוש |
|--------|------|-------|
| `@agentclientprotocol/sdk` | `^0.16.1` | ACP ClientSideConnection |
| `@google/genai` | latest | Gemini STT (שליחת אודיו, קבלת טקסט) |

ElevenLabs — קריאות REST ישירות ללא SDK (פשוט יותר לPOC).

### Frontend

ללא תלויות. רק Web APIs:
- `MediaRecorder` — הקלטת אודיו
- `WebSocket` — תקשורת עם backend
- `Audio` / `AudioContext` — השמעת MP3

---

## 4. פרוטוקול WebSocket (Frontend ↔ Backend)

כל ההודעות הן JSON.

### Frontend → Backend

```ts
// אתחול — נשלח מיד עם פתיחת WebSocket
{ type: "init", cwd: string, sessionId?: string }

// אודיו — נשלח אחרי שחרור הכפתור
{ type: "audio", data: string }  // base64 של WebM/Opus blob

// ביטול — נשלח אם המשתמש רוצה להפסיק
{ type: "cancel" }
```

### Backend → Frontend

```ts
// ACP מוכן, session נטענה
{ type: "ready", sessionId: string }

// STT הסתיים — מציג את הטקסט שזוהה + מתחיל השמעת צליל "חושב"
{ type: "thinking", transcript: string }

// חלק מתשובת המודל (streaming text) — לתצוגה בלבד, לא לTTS
{ type: "text_chunk", text: string }

// MP3 מוכן (base64) — Frontend מנגן מיד
{ type: "audio_ready", data: string }  // base64 MP3

// סיום תור
{ type: "done" }

// שגיאה
{ type: "error", message: string }
```

### TTS — גישה לPOC: Wait-then-speak

לPOC: **ממתינים לתשובה מלאה מהמודל, אז שולחים לElevenLabs, אז מנגנים.**
זה מפשט מאוד את ה-state management.
שיפור עתידי: streaming TTS משפט-משפט (כשקומה מסיום משפט מה-stream).

---

## 5. ACP Bridge (backend/src/acp-bridge.ts)

### אתחול

```ts
import { spawn } from "bun";
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";

// spawn opencode acp
const proc = spawn(["opencode", "acp", "--cwd", cwd], {
  stdin: "pipe",
  stdout: "pipe",
  stderr: "inherit",
});

// יצירת stream
const stream = ndJsonStream(
  proc.stdin,   // WritableStream<Uint8Array>
  proc.stdout,  // ReadableStream<Uint8Array>
);

// ACP connection — Backend הוא ה-Client
const connection = new ClientSideConnection(
  (agent) => createClientHandler(agent, onUpdate),
  stream,
);

// initialize (handshake)
await connection.initialize({
  protocolVersion: "0.1",
  capabilities: {},
  clientInfo: { name: "voice-acp", version: "0.1.0" },
});
```

### Client Handler (מקבל notifications מהAgent)

```ts
function createClientHandler(agent, onUpdate) {
  return {
    // מופעל כאשר המודל שולח chunk — streaming output
    async sessionUpdate(params) {
      onUpdate(params);  // → WebSocket text_chunk לfrontend
    },
    // מופעל כאשר המודל מבקש אישור כלי
    async requestPermission(params) {
      // לPOC: approve הכל אוטומטית
      return { outcome: "approved", option: params.options[0] };
    },
  };
}
```

### שליחת הודעה

```ts
// session חדשה
const { sessionId } = await connection.newSession({
  cwd,
  mcpServers: [],
});

// session קיימת
const { sessionId } = await connection.loadSession({
  id: existingSessionId,
  cwd,
  mcpServers: [],
});

// שליחת prompt
const response = await connection.prompt({
  sessionId,
  messages: [
    { role: "user", content: [{ type: "text", text: userText }] }
  ],
});
// response.messages[0].content → תשובת המודל
```

---

## 6. STT — Gemini (backend/src/stt.ts)

```ts
import { GoogleGenerativeAI } from "@google/genai";

// OneCLI מחליף את ה-x-goog-api-key header במפתח האמיתי בדרך לgenerativelanguage.googleapis.com
// הSDK מאותחל עם placeholder — אין צורך במשתנה סביבה
const genai = new GoogleGenerativeAI("placeholder");

export async function transcribeAudio(audioBase64: string): Promise<string> {
  // להשתמש תמיד ב-alias של הגרסה האחרונה — לא לנעול גרסה ספציפית
  // gemini-flash-latest = Flash, gemini-flash-lite-latest = Flash Lite (מהיר יותר, זול יותר)
  // לSTT מספיק Flash Lite
  const model = genai.getGenerativeModel({ model: "gemini-flash-lite-latest" });
  
  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: "audio/webm",
        data: audioBase64,
      },
    },
    { text: "Please transcribe this audio exactly as spoken. Return only the transcription, no additional text." },
  ]);
  
  return result.response.text();
}
```

---

## 7. TTS — ElevenLabs (backend/src/tts.ts)

```ts
export async function textToSpeech(text: string): Promise<string> {
  const voiceId = process.env.ELEVENLABS_VOICE_ID!;  // היחיד שנשאר כenv var

  // OneCLI מזריק xi-api-key header אוטומטית לapi.elevenlabs.io
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": "placeholder",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    },
  );
  
  if (!response.ok) throw new Error(`ElevenLabs error: ${response.status}`);
  
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}
```

---

## 8. Backend Server (backend/src/server.ts)

```
State per WebSocket connection:
- acpConnection: ClientSideConnection | null
- sessionId: string | null
- currentProc: ChildProcess | null
- fullResponseText: string  ← מצטבר בזמן streaming
```

### זרימת "init"

```
receive { type: "init", cwd, sessionId? }
  → spawn opencode acp --cwd <cwd>
  → ClientSideConnection + initialize()
  → newSession() or loadSession()
  → send { type: "ready", sessionId }
```

### זרימת "audio"

```
receive { type: "audio", data: base64 }
  → transcribeAudio(data)           ← Gemini STT
  → send { type: "thinking", transcript }
  → connection.prompt({ sessionId, messages: [{...text...}] })
      ↓ (בזמן שממתין)
      sessionUpdate notifications → send { type: "text_chunk", text }
      (מצטבר fullResponseText)
  → (אחרי response מלא)
  → textToSpeech(fullResponseText)  ← ElevenLabs
  → send { type: "audio_ready", data: base64MP3 }
  → send { type: "done" }
```

---

## 9. Frontend (frontend/index.html)

### URL Params

```
http://localhost:3000/?cwd=/path/to/workspace
http://localhost:3000/?cwd=/path/to/workspace&session=SESSION_ID
```

הfrontend קורא את ה-params ב-`DOMContentLoaded` ושולח `init` לbackend.

### State Machine של הכפתור

```
IDLE → [לחץ] → RECORDING → [שחרר] → PROCESSING → SPEAKING → IDLE
                                                      ↓
                                               [audio_ready] → play MP3
```

### אלמנטים בממשק

```html
<div id="status">...</div>       <!-- "מוכן" / "מקשיב..." / "חושב..." / "מדבר..." -->
<button id="btn">🎙</button>     <!-- גדול, עגול, ממורכז -->
<div id="transcript">...</div>   <!-- הטקסט שזוהה בSTT -->
<div id="response">...</div>     <!-- תשובת המודל (streaming text) -->
```

### צליל "חושב"

```js
// בעת קבלת { type: "thinking" }
const thinking = new Audio("thinking.mp3");  // קובץ קצר, לולאה
thinking.loop = true;
thinking.play();

// בעת קבלת { type: "audio_ready" } — עצור לפני ניגון התשובה
thinking.pause();
```

קובץ `thinking.mp3` — כל צליל ניטרלי קצר (chime, pulse וכו').
להכניס ל-`frontend/thinking.mp3`.

---

## 10. משתני סביבה

המפתחות מוגדרים כ-environment variables דרך 1CLI — אין קובץ `.env`.

| משתנה | שימוש |
|-------|-------|
| `ELEVENLABS_VOICE_ID` | מזהה הקול (למשל `21m00Tcm4TlvDq8ikWAM`) |
| `PORT` | פורט הbackend (ברירת מחדל: 3000) |

**מפתחות API** — מנוהלים דרך OneCLI:
- `GEMINI_API_KEY` (`generativelanguage.googleapis.com`, header: `x-goog-api-key`) — להוסיף ב-OneCLI
- `ELEVENLABS_API_KEY` (`api.elevenlabs.io`, header: `xi-api-key`) — להוסיף ב-OneCLI

הקוד מאתחל SDKs עם `"placeholder"` — OneCLI מחליף את ה-header במפתח האמיתי בדרך.

---

## 11. מבנה קבצים סופי

```
voice-acp/
├── backend/
│   ├── src/
│   │   ├── server.ts       # Bun WebSocket server + HTTP (GET /)
│   │   ├── acp-bridge.ts   # spawn opencode acp + ClientSideConnection
│   │   ├── stt.ts          # Gemini STT
│   │   └── tts.ts          # ElevenLabs TTS
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── frontend/
│   ├── index.html          # הכל בקובץ אחד
│   └── thinking.mp3        # צליל "חושב"
├── docs/
│   └── spec.md             # מסמך זה
├── README.md
└── AGENTS.md
```

---

## 12. שאלות פתוחות / החלטות עתידיות

| נושא | גישה לPOC | שיפור עתידי |
|------|-----------|-------------|
| TTS | Wait-then-speak | Streaming TTS משפט-משפט |
| Permission requests | Auto-approve | UI dialog |
| sessionUpdate | text_chunk לtranscript בלבד | פרסור מלא של tool calls |
| מספר sessions | אחת ל-WebSocket connection | מנהל sessions מלא |
| אבטחה | localhost בלבד | Auth + TLS |
| Thinking sound | קובץ MP3 קשוח | בחירה בהגדרות |

---

## 13. סדר בנייה מוצע

1. `backend/src/tts.ts` — הכי קל, בדיקה ישירה
2. `backend/src/stt.ts` — Gemini API
3. `backend/src/acp-bridge.ts` — spawn + ClientSideConnection + prompt פשוט
4. `backend/src/server.ts` — WebSocket + חיבור של 1-3
5. `frontend/index.html` — UI + WebSocket client
6. בדיקה end-to-end
