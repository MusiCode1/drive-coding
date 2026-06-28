import adapter from "@sveltejs/adapter-static"
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte"
import { execSync } from "node:child_process"
import pkg from "../../package.json" with { type: "json" }

let sha = "nogit"
try {
  sha = execSync("git rev-parse --short HEAD").toString().trim()
} catch {}
const appVersion = `v${pkg.version} (${sha})`

/** @type {import('@sveltejs/kit').Config} */
const out = process.env.FE_BUILD_OUT ?? "build"
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: out,
      assets: out,
      fallback: "index.html",
      precompress: false,
    }),
    version: { name: appVersion },
  },
  vitePlugin: {
    inspector: true,
  },
}

export default config;