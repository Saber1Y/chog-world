import { defineConfig } from "drizzle-kit";

/** Generates SQL migrations from the schema; applied at boot by src/database/migrate.ts. */
export default defineConfig({
  schema: "./src/database/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
});
