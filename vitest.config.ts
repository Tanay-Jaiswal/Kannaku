// Vitest config: only the "@/..." path alias the app uses (tsconfig paths). Tests run in Node, no network.
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { environment: "node" },
});
