import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// В разработке запросы к API проксируются на локальный backend.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8765" } },
});
