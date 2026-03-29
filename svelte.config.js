import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    // Public OAuth token exchange uses cross-origin form posts from ChatGPT's backend.
    // We keep application-level CSRF protection in hooks/server-security for session-bound routes.
    csrf: {
      checkOrigin: false
    },
    alias: {
      $lib: 'src/lib'
    }
  }
};

export default config;
