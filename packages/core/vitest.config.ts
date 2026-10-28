import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    // Test files share one database that is emptied before each test, so they must not run in parallel.
    fileParallelism: false,
  },
});
