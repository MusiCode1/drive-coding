import { sveltekit } from "@sveltejs/kit/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

// BE port — defaults to 4000, override with BE_PORT=4001 for parallel worktrees.
// See root AGENTS.md → Ports + "Running parallel worktrees" if exists.
const BE_PORT = Number(process.env.BE_PORT ?? 4000)

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    // port: OS-assigned. Vite prints chosen port at startup.
    allowedHosts: [".tuns.sh", ".trycloudflare.com", "localhost"],
    proxy: {
      "/api": `http://localhost:${BE_PORT}`,
      "/proxy": `http://localhost:${BE_PORT}`,
      "/ws": { target: `ws://localhost:${BE_PORT}`, ws: true },
    },
  },
})
