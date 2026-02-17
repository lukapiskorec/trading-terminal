import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api/gamma": {
        target: "https://gamma-api.polymarket.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/gamma/, ""),
      },
    },
  },
});
