import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { entryHtml } from "./src/demo/boot.ts";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // FLIGHTDECK_ENTRY=web serves the browser entry (the demo and its prints); the app's is Tauri's.
    {
      name: "flightdeck-entry",
      transformIndexHtml: (html) => entryHtml(html, process.env.FLIGHTDECK_ENTRY),
    },
  ],
  // `@/` is src/ (shadcn/ui's generated code imports through it); tsconfig has the same path.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
});
