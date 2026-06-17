#!/usr/bin/env bun
// packages/backend/src/bin/drive-coding.ts
import path from "node:path"

// FE build sits at packages/frontend/build.
// This file is at packages/backend/src/bin → go up three levels (bin→src→backend→packages),
// then into frontend/build.
const feBuildDir = path.resolve(import.meta.dirname, "../../../frontend/build")

// Do not override values the user set explicitly (env > default).
process.env.FE_STATIC_DIR ??= feBuildDir
process.env.PORT ??= "4000"

// This import starts the server (side-effect, rises on-import).
// Must come AFTER env is set (server.ts reads env on-import).
await import("../server.js")
