import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// When GitHub Actions builds this for Pages the site is served from
// https://<user>.github.io/<repo>/, so assets need that repo path as their
// base. The Pages workflow sets BASE_PATH; local dev and any root-domain
// host fall back to '/'.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
});
