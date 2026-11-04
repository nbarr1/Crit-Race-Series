import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    env: { NEXT_PUBLIC_SITE_URL: "http://localhost:3000" },
    environment: "node",
  },
});
