---
id: session-lifecycle
title: Session lifecycle — open, send, close
summary: How to spawn an agent, drive a turn and release it, including who owns the session.
read_when:
  - You need to spawn an agent and get its id
  - A turn is running and you must decide between waiting and forcing
  - You are about to leave an agent open and want to know who owns it
tags: [session, ownership, turnstate]
surface: [http, mcp]
stability: stable
routes: [POST /api/agents, DELETE /api/agents/:id]
mcp_tools: [session_open, session_send, session_close]
docs_version: 1.0.0
updated: 2026-09-28
---

# Session lifecycle

You open it, you close it.

This document is a skeleton seed; its body is written in stage 1a.
