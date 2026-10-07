import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  // Subpath tylko przy buildzie pod GitHub Pages (matuzale.github.io/bentos-satbaltyk-dashboard/) -
  // lokalny dev server zostaje pod "/", zeby npm run dev dzialalo bez niespodzianek.
  base: command === "build" ? "/bentos-satbaltyk-dashboard/" : "/",
  plugins: [react()],
}));
