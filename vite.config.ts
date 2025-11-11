import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/events_tracker/",   // IMPORTANT for GitHub Pages
});
