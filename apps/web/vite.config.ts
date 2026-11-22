import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Loaded only when a video is opened (src/video/media.ts). Prepared when the dev server
    // starts, so that the first use does not make the dev server reload the page.
    include: ["mediabunny"],
  },
});
