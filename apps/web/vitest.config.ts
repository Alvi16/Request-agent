import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The tools run against the test database of the business core, created and migrated there.
    globalSetup: ["@request-agent/core/testing/global-setup"],
    // Test files share one database that is emptied before each test, so they must not run in parallel.
    fileParallelism: false,
  },
});
