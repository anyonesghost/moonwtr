// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  output: 'static',

  // GitHub Pages — set `site` to your Pages URL.
  // For a user/org page (username.github.io) leave base as '/'.
  // For a project page (username.github.io/repo) set base to '/repo-name/'.
  site: 'https://jaypaulnewhouse.github.io',
  // base: '/my-portfolio',
});
