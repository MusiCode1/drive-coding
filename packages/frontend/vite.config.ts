import { sveltekit } from "@sveltejs/kit/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    // port: OS-assigned. Vite prints chosen port at startup.
    // BE is fixed at 4000 (single instance). See root AGENTS.md → Ports.
    allowedHosts: [".tuns.sh", ".trycloudflare.com", "localhost"],
    proxy: {
      "/api": "http://localhost:4000",
      "/proxy": "http://localhost:4000",
      "/ws": { target: "ws://localhost:4000", ws: true },
    },
  },
})
