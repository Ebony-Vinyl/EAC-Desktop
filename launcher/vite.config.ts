import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1", port: 5178, strictPort: true,
    watch: { ignored: ["**/.verify/**", "**/runtime/**", "**/src-tauri/**"] },
  },
  envPrefix: ["VITE_"],
  build: { target: "es2022" },
});
