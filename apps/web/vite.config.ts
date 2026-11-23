import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Loaded only when a video is opened (src/video/media.ts). Prepared when the dev server
    // starts, so that the first use does not make the dev server reload the page.
    include: ["mediabunny"],
  },
  build: {
    rolldownOptions: {
      output: {
        // Vite drops legal comments (`/*!`, `@license`) when it minifies. Keep them, so that
        // Mediabunny's MPL-2.0 header stays in the chunk that carries its code.
        comments: { legal: true },
        // Mediabunny in a chunk of its own, loaded with the video screen only: its MPL-2.0 code
        // stays in one file, apart from the editor's code.
        codeSplitting: {
          groups: [{ name: "mediabunny", test: /[\\/]node_modules[\\/]mediabunny[\\/]/ }],
        },
      },
    },
  },
});
