/**
 * Server — Bun WebSocket + HTTP server.
 *
 * - GET /            → frontend/index.html
 * - GET /<file>      → frontend/<file>
 * - WS  /ws          → WebSocket לתקשורת קולית
 *
 * פרוטוקול WebSocket: ראה docs/spec.md §4.
 */

import { resolve } from "node:path";
import { readdir } from "node:fs/promises";
import { dirname, sep as PATH_SEP } from "node:path";
import { transcribeAudio } from "./stt.ts";
import { cachedTextToSpeechBase64, streamCachedTextToSpeech } from "./tts.ts";
import { createAcpBridge, type AcpBridge } from "./acp-bridge.ts";
import { VOICE_SYSTEM_PROMPT } from "./system-prompt.ts";
import { renderMarkdown } from "./markdown.ts";
import { narrateToolCall, translateThought } from "./gemini-helper.ts";
import {
  recordingsDir,
  recordingsEnabled,
  saveRecording,
  saveRecordingMetadata,
} from "./recordings.ts";
import { findSentenceBoundary } from "./sentence-boundary.ts";
import type { ClientMessage, ServerMessage, MessageSink } from "./ws-protocol.ts";
import type { ConnState } from "./conn-state.ts";
import { createConnState } from "./conn-state.ts";
import { handlePromptText } from "./prompt-handler.ts";

const PORT = Number(process.env.PORT ?? 3000);
const FRONTEND_DIR = resolve(import.meta.dir, "../../frontend");

/**
 * האם להציג stderr של opencode acp ב-stderr של ה-server.
 * controlled by `VOICE_ACP_VERBOSE`. ערך `1`/`true` (case-insensitive) מפעיל.
 * בכל מקרה, ה-stderr נתפס לbuffer פנימי ל-error extraction.
 */
const VERBOSE = (() => {
  const v = (process.env.VOICE_ACP_VERBOSE ?? "0").toLowerCase();
  return v === "1" || v === "true";
})();

// ── סוגי הודעות WebSocket ─────────────────────────────────────────────────────
// (Defined in ws-protocol.ts — imported above. Kept here as a re-export
// marker so old grep patterns still find this section.)

const states = new WeakMap<WebSocket, ConnState>();

// ── HTTP + WS server ─────────────────────────────────────────────────────────

const server = Bun.serve({
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);

    // upgrade ל-WebSocket
    if (url.pathname === "/ws") {
      if (srv.upgrade(req)) return undefined; // הצליח
      return new Response("Upgrade failed", { status: 400 });
    }

    // API: GET /api/info?cwd=... → אילו מודלים זמינים + sessions קיימות
    if (url.pathname === "/api/info") {
      return handleApiInfo(url);
    }

    // API: GET /api/voices → רשימת קולות זמינים מ-ElevenLabs
    if (url.pathname === "/api/voices") {
      return handleApiVoices();
    }

    // API: POST /api/tts {text, voiceId?} → base64 MP3
    if (url.pathname === "/api/tts" && req.method === "POST") {
      return handleApiTts(req);
    }

    // API: GET /api/ls?path=<absolute> → רשימת תת-תיקיות (לבוחר התיקיות)
    if (url.pathname === "/api/ls") {
      return handleApiLs(url);
    }

    // הגשת קבצים סטטיים מ-frontend/
    return serveStatic(url.pathname);
  },
  websocket: {
    open(ws) {
      states.set(ws as any, createConnState());
      console.log("[ws] חיבור חדש");
    },
    async message(ws, raw) {
      const state = states.get(ws as any);
      if (!state) return;

      let msg: ClientMessage;
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      } catch (e) {
        sendError(ws, "JSON לא תקין");
        return;
      }

      try {
        await handleMessage(ws, state, msg);
      } catch (e) {
        console.error("[ws] שגיאה בטיפול בהודעה:", e);
        sendError(ws, String((e as Error).message ?? e));
      }
    },
    async close(ws) {
      const state = states.get(ws as any);
      if (state?.bridge) {
        await state.bridge.dispose().catch(() => {});
      }
      states.delete(ws as any);
      console.log("[ws] חיבור נסגר");
    },
  },
});

console.log(`שרת voice-acp רץ ב-http://localhost:${server.port}`);
console.log(`  GET  http://localhost:${server.port}/    → frontend`);
console.log(`  WS   ws://localhost:${server.port}/ws    → תקשורת קולית`);
console.log(
  `  recordings: ${recordingsEnabled ? "ON" : "OFF"} (${recordingsDir})`,
);
console.log(
  `  verbose:    ${VERBOSE ? "ON" : "OFF"} (set VOICE_ACP_VERBOSE=1 ל-stderr של opencode)`,
);

// ── טיפול בהודעות ────────────────────────────────────────────────────────────

async function handleMessage(
  ws: any,
  state: ConnState,
  msg: ClientMessage,
): Promise<void> {
  switch (msg.type) {
    case "init":
      await handleInit(ws, state, msg);
      break;

    case "audio":
      await handleAudio(ws, state, msg);
      break;

    case "text":
      // נתיב דיבוג — מדלגים על STT, ישר prompt
      await handleUserInput(ws, state, msg.text);
      break;

    case "cancel":
      if (state.bridge) {
        await state.bridge.cancel().catch(() => {});
      }
      break;

    default:
      sendError(ws, `סוג הודעה לא ידוע: ${(msg as any).type}`);
  }
}

async function handleInit(
  ws: any,
  state: ConnState,
  msg: Extract<ClientMessage, { type: "init" }>,
): Promise<void> {
  if (state.bridge) {
    sendError(ws, "כבר אותחל");
    return;
  }

  // שמירת voiceId + cwd לשימוש בכל ה-TTS וה-recordings של ה-session
  state.voiceId = msg.voice ?? null;
  state.cwd = msg.cwd;

  console.log(
    `[ws] init cwd=${msg.cwd} session=${msg.sessionId ?? "(new)"} voice=${state.voiceId ?? "(default)"}`,
  );
  state.bridge = await createAcpBridge({ cwd: msg.cwd, printAgentLogs: VERBOSE });

  let sessionResult;
  if (msg.sessionId) {
    // session קיימת — נטען עם streaming של היסטוריה ל-frontend.
    // ההיסטוריה כוללת את ה-system prompt, אז מסמנים כנשלח.
    state.firstPromptSent = true;
    send(ws, { type: "history_start" });

    // buffer לרינדור markdown של סגמנטים בהיסטוריה (כמו flushMessage ב-live)
    let historyMessageBuffer = "";
    const flushHistoryMessage = () => {
      const t = historyMessageBuffer.trim();
      historyMessageBuffer = "";
      if (!t) return;
      try {
        const html = renderMarkdown(t);
        send(ws, { type: "message_rendered", html, source: "history" });
      } catch (e) {
        console.error(`[ws] render history נכשל: ${(e as Error).message}`);
      }
    };

    sessionResult = await state.bridge.loadSession(msg.sessionId, {
      onChunk: (chunk, kind) => {
        send(ws, { type: "history_chunk", text: chunk, kind });
        if (kind === "message") {
          historyMessageBuffer += chunk;
        } else if (
          (kind === "thought" || kind === "user_message") &&
          historyMessageBuffer.length > 0
        ) {
          flushHistoryMessage();
        }
      },
      onToolCall: (event) => {
        send(ws, {
          type: "history_tool_call",
          event: event.event,
          toolCallId: event.toolCallId,
          title: event.title,
          toolKind: event.toolKind,
          status: event.status,
        });
        if (event.event === "create" && historyMessageBuffer.length > 0) {
          flushHistoryMessage();
        }
      },
    });
    // flush סופי
    flushHistoryMessage();
    send(ws, { type: "history_done" });
  } else {
    sessionResult = await state.bridge.newSession();
  }

  // אם התבקש model ספציפי — הגדרה אחרי הקמת ה-session
  if (msg.model && msg.model !== sessionResult.currentModelId) {
    try {
      await state.bridge.setModel(msg.model);
      sessionResult.currentModelId = msg.model;
    } catch {
      sendError(ws, `לא ניתן להגדיר model=${msg.model}; נשאר עם ברירת המחדל`);
    }
  }

  state.sessionId = sessionResult.sessionId;

  send(ws, {
    type: "ready",
    sessionId: sessionResult.sessionId,
    availableModels: sessionResult.availableModels,
    currentModelId: sessionResult.currentModelId,
  });
}

async function handleAudio(
  ws: any,
  state: ConnState,
  msg: Extract<ClientMessage, { type: "audio" }>,
): Promise<void> {
  if (!state.bridge) {
    sendError(ws, "צריך לשלוח init קודם");
    return;
  }
  if (state.busy) {
    sendError(ws, "כבר בעיבוד הודעה אחרת");
    return;
  }

  // 0. שמירת הקלטה (אופציונלי, controlled by env). מתבצע ברקע במקביל
  //    ל-STT כדי לא להאריך את ה-latency של התגובה.
  const mimeType = msg.mimeType ?? "audio/webm";
  const recPromise = saveRecording(msg.data, mimeType, state.sessionId);

  // 1. STT: אודיו → טקסט
  console.log(`[ws] STT (${msg.data.length} chars base64)`);
  const transcript = await transcribeAudio(msg.data, {
    mimeType,
    previousResponse: state.lastAgentMessage ?? undefined,
  });
  send(ws, { type: "transcript", text: transcript });

  // השלמת שמירת ההקלטה ברקע + metadata עם transcript.
  // לא ממתינים — אסור שזה ידחה את ה-prompt או את ה-done.
  recPromise.then(async (info) => {
    if (!info) return;
    await saveRecordingMetadata(info, {
      timestamp: info.timestamp,
      sessionId: state.sessionId,
      cwd: state.cwd,
      mimeType,
      audioSize: Buffer.from(msg.data, "base64").byteLength,
      transcript,
      sttModel: "gemini-flash-latest",
    });
  });

  if (!transcript) {
    send(ws, { type: "done" });
    return;
  }

  await handleUserInput(ws, state, transcript);
}

async function handleUserInput(
  ws: any,
  state: ConnState,
  text: string,
): Promise<void> {
  const sink: MessageSink = {
    send: (msg) => send(ws, msg),
    sendError: (message) => sendError(ws, message),
  };
  await handlePromptText(sink, state, text, {
    systemPrompt: VOICE_SYSTEM_PROMPT,
    streamTts: (segText, voiceId, onChunk) =>
      streamCachedTextToSpeech(segText, { voiceId }, onChunk),
    translateThought,
    narrateToolCall,
    renderMarkdown,
  });
}


// ── עזרים ────────────────────────────────────────────────────────────────────

function send(ws: any, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}

function sendError(ws: any, message: string): void {
  send(ws, { type: "error", message });
}

/**
 * GET /api/info?cwd=<path>
 *
 * spawns opencode זמני, מוציא רשימת מודלים זמינים + sessions קיימות, וסוגר.
 * עלות: ~3-5 שניות לכל קריאה (overhead של opencode).
 */
async function handleApiInfo(url: URL): Promise<Response> {
  const cwd = url.searchParams.get("cwd");
  if (!cwd) {
    return Response.json({ error: "חסר פרמטר cwd" }, { status: 400 });
  }

  let bridge: AcpBridge | null = null;
  try {
    bridge = await createAcpBridge({ cwd });
    // יוצרים session זמני רק כדי לקבל את ה-availableModels
    const tempSession = await bridge.newSession();
    // ננסה לטעון sessions קיימות (אם הסוכן תומך)
    const sessions = await bridge.listSessions().catch(() => []);

    return Response.json({
      cwd,
      availableModels: tempSession.availableModels ?? [],
      currentModelId: tempSession.currentModelId ?? null,
      sessions,
    });
  } catch (e) {
    return Response.json(
      { error: String((e as Error).message ?? e) },
      { status: 500 },
    );
  } finally {
    await bridge?.dispose().catch(() => {});
  }
}

/**
 * GET /api/voices → רשימת קולות זמינים מ-ElevenLabs.
 * מחזיר רק שדות שימושיים, ומסמן קולות שתומכים עברית.
 */
async function handleApiVoices(): Promise<Response> {
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": "placeholder", // OneCLI מזריק את האמיתי
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      return Response.json(
        { error: `ElevenLabs error ${res.status}` },
        { status: 502 },
      );
    }
    const data: any = await res.json();
    const voices = (data?.voices ?? []).map((v: any) => {
      const langs = (v.verified_languages ?? []).map(
        (l: any) => l.language ?? l.language_id,
      );
      return {
        voiceId: v.voice_id,
        name: v.name,
        category: v.category, // premade / cloned / generated / professional
        description: v.description ?? null,
        languages: langs,
        supportsHebrew: langs.includes("he") || (v.labels?.language === "he"),
      };
    });
    // מיון: ברירת מחדל ראשון, אחר-כך תומכי עברית, אחר-כך premade, ואז שאר
    const defaultId = process.env.ELEVENLABS_VOICE_ID ?? "";
    voices.sort((a: any, b: any) => {
      if (a.voiceId === defaultId) return -1;
      if (b.voiceId === defaultId) return 1;
      if (a.supportsHebrew !== b.supportsHebrew) {
        return a.supportsHebrew ? -1 : 1;
      }
      const order = { premade: 0, professional: 1, cloned: 2, generated: 3 };
      const ao = order[a.category as keyof typeof order] ?? 9;
      const bo = order[b.category as keyof typeof order] ?? 9;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    });
    return Response.json({
      defaultVoiceId: defaultId || null,
      voices,
    });
  } catch (e) {
    return Response.json(
      { error: String((e as Error).message ?? e) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/tts
 * Body: { text, voiceId? }
 * → { data: <base64 MP3> }
 *
 * משמש להשמעה lazy של בועות היסטוריה. עובר דרך cache, אז קריאה חוזרת
 * לאותו טקסט+voice מחזירה מיד.
 */
async function handleApiTts(req: Request): Promise<Response> {
  let body: { text?: string; voiceId?: string };
  try {
    body = (await req.json()) as { text?: string; voiceId?: string };
  } catch {
    return Response.json({ error: "JSON לא תקין" }, { status: 400 });
  }
  const text = (body.text ?? "").trim();
  if (!text) {
    return Response.json({ error: "חסר text" }, { status: 400 });
  }
  try {
    const data = await cachedTextToSpeechBase64(text, {
      voiceId: body.voiceId,
    });
    return Response.json({ data });
  } catch (e) {
    return Response.json(
      { error: String((e as Error).message ?? e) },
      { status: 500 },
    );
  }
}

/**
 * GET /api/ls?path=<absolute>&showHidden=1
 * רשימת תת-תיקיות בנתיב נתון. מסנן קבצים, מציג רק תיקיות.
 *
 * סייגי ביטחון: רק תחת `$HOME` או `/tmp`. dot-folders מסוננים כברירת מחדל.
 */
async function handleApiLs(url: URL): Promise<Response> {
  const path = url.searchParams.get("path") ?? "";
  const showHidden = url.searchParams.get("showHidden") === "1";
  const home = process.env.HOME ?? "/home/user";

  if (!path.startsWith("/")) {
    return Response.json(
      { error: "path חייב להיות absolute" },
      { status: 400 },
    );
  }
  // ביטחון: רק תחת home או /tmp
  const allowed = [home, "/tmp"];
  const isAllowed = allowed.some(
    (root) => path === root || path.startsWith(root + PATH_SEP),
  );
  if (!isAllowed) {
    return Response.json(
      { error: `path מחוץ לטווח המותר (מותר רק תחת ${home} או /tmp)` },
      { status: 403 },
    );
  }

  try {
    const entries = await readdir(path, { withFileTypes: true });
    const dirs = entries
      .filter((e) => {
        if (!e.isDirectory()) return false;
        if (!showHidden && e.name.startsWith(".")) return false;
        return true;
      })
      .map((e) => ({ name: e.name, type: "directory" as const }))
      .sort((a, b) => a.name.localeCompare(b.name, "he"));

    // parent מותר רק אם הוא בתוך הטווח המותר
    let parent: string | null = path === "/" ? null : dirname(path);
    if (parent) {
      const parentAllowed = allowed.some(
        (root) => parent === root || parent!.startsWith(root + PATH_SEP),
      );
      if (!parentAllowed) parent = null;
    }

    return Response.json({
      path,
      parent,
      home,
      entries: dirs,
    });
  } catch (e) {
    return Response.json(
      { error: String((e as Error).message ?? e) },
      { status: 500 },
    );
  }
}

async function serveStatic(pathname: string): Promise<Response> {
  // הגנת path traversal — לאשר רק שמות סבירים
  if (pathname.includes("..") || pathname.includes("\0")) {
    return new Response("Bad request", { status: 400 });
  }

  const relative = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(FRONTEND_DIR, "." + relative);

  // לוודא שהקובץ באמת תחת FRONTEND_DIR (הגנת escaping)
  if (!filePath.startsWith(FRONTEND_DIR)) {
    return new Response("Forbidden", { status: 403 });
  }

  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(file);
}
