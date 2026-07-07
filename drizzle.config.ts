import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit (unlike Next.js) does not auto-load .env files, so DATABASE_URL
// would be undefined when running `db:*` scripts. Load it here — .env.local
// first so it takes precedence, matching Next's env resolution order.
config({ path: ".env.local" });
config({ path: ".env" });

export default defineConfig({
  schema: "./db/schema/index.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
