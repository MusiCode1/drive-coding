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
import { handleAudioInput } from "./audio-handler.ts";
import { handleInitMessage } from "./init-handler.ts";
import { resolveStaticPath } from "./static-path.ts";
import { handleApiVoices as apiVoicesLogic } from "./api-voices.ts";
import { handleApiTts as apiTtsLogic } from "./api-tts.ts";
import { handleApiLs as apiLsLogic } from "./api-ls.ts";
import { handleApiInfo as apiInfoLogic } from "./api-info.ts";

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

/** Build a MessageSink that wraps a Bun WebSocket. */
function wsSink(ws: any): MessageSink {
  return {
    send: (msg) => send(ws, msg),
    sendError: (message) => sendError(ws, message),
  };
}

/** Standard PromptHandlerDeps used by every handler in production. */
const promptDeps = {
  systemPrompt: VOICE_SYSTEM_PROMPT,
  streamTts: (text: string, voiceId: string | undefined, onChunk: (c: Uint8Array) => void) =>
    streamCachedTextToSpeech(text, { voiceId }, onChunk),
  translateThought,
  narrateToolCall,
  renderMarkdown,
};

async function handleInit(
  ws: any,
  state: ConnState,
  msg: Extract<ClientMessage, { type: "init" }>,
): Promise<void> {
  await handleInitMessage(wsSink(ws), state, msg, {
    createBridge: (opts) => createAcpBridge(opts),
    renderMarkdown,
    printAgentLogs: VERBOSE,
  });
}

async function handleAudio(
  ws: any,
  state: ConnState,
  msg: Extract<ClientMessage, { type: "audio" }>,
): Promise<void> {
  await handleAudioInput(wsSink(ws), state, msg, {
    ...promptDeps,
    saveRecording,
    saveRecordingMetadata,
    transcribeAudio,
    sttModelName: "gemini-flash-latest",
  });
}

async function handleUserInput(
  ws: any,
  state: ConnState,
  text: string,
): Promise<void> {
  await handlePromptText(wsSink(ws), state, text, promptDeps);
}


// ── עזרים ────────────────────────────────────────────────────────────────────

function send(ws: any, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}

function sendError(ws: any, message: string): void {
  send(ws, { type: "error", message });
}

async function handleApiInfo(url: URL): Promise<Response> {
  const result = await apiInfoLogic(url.searchParams.get("cwd"), {
    createBridge: (opts) => createAcpBridge(opts),
  });
  return Response.json(result.body, {
    status: result.ok ? 200 : result.status,
  });
}

/**
 * GET /api/voices → list of available ElevenLabs voices, sorted.
 */
async function handleApiVoices(): Promise<Response> {
  const result = await apiVoicesLogic({
    defaultVoiceId: process.env.ELEVENLABS_VOICE_ID ?? "",
    async fetchVoices() {
      const res = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: {
          "xi-api-key": "placeholder", // OneCLI injects real key
          Accept: "application/json",
        },
      });
      if (!res.ok) return { ok: false, status: res.status };
      const data: any = await res.json();
      return { ok: true, status: 200, voices: data?.voices ?? [] };
    },
  });
  return Response.json(result.body, {
    status: result.ok ? 200 : result.status,
  });
}

async function handleApiTts(req: Request): Promise<Response> {
  const result = await apiTtsLogic(
    () => req.json(),
    {
      async textToSpeech(text, voiceId) {
        return cachedTextToSpeechBase64(text, { voiceId });
      },
    },
  );
  return Response.json(result.body, {
    status: result.ok ? 200 : result.status,
  });
}

async function handleApiLs(url: URL): Promise<Response> {
  const result = await apiLsLogic(
    url.searchParams.get("path") ?? "",
    url.searchParams.get("showHidden") === "1",
    {
      home: process.env.HOME ?? "/home/user",
      async readDirectory(path) {
        return readdir(path, { withFileTypes: true });
      },
    },
  );
  return Response.json(result.body, {
    status: result.ok ? 200 : result.status,
  });
}

async function serveStatic(pathname: string): Promise<Response> {
  const result = resolveStaticPath(pathname, FRONTEND_DIR);
  if (!result.ok) {
    return new Response(result.message, { status: result.status });
  }
  const file = Bun.file(result.filePath);
  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(file);
}
