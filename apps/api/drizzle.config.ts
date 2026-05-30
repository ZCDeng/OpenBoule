import { defineConfig } from "drizzle-kit";

// drizzle-kit 从 TS schema 生成 SQL 迁移到 src/db/migrations。
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://boule:boule_dev_pw_change_me@localhost:5432/boule",
  },
  verbose: true,
  strict: true,
});
