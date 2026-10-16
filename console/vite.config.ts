import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the console runs on :5173 and proxies the API; in production FastAPI serves dist/.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8000" } },
});
