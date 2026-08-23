import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" so the built site works from any static host, including subpaths.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: { three: ["three"], react: ["react", "react-dom"] },
      },
    },
  },
});
