import { defineConfig } from "vite";

export default defineConfig({
  // Relative base lets the built bundle run from any subdirectory on Pages.
  base: "./",
  clearScreen: false,
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
