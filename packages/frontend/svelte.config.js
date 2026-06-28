import adapter from "@sveltejs/adapter-static"
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte"

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
  },
  vitePlugin: {
    inspector: true,
  },
}

export default config;