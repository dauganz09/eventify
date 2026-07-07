import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const client = postgres(connectionString, {
  // Required when using a transaction-mode connection pooler (e.g. pgBouncer)
  prepare: false,
  // Keep pool connections healthy — drop idle connections after 20 s so a
  // Docker restart or network blip doesn't leave stale sockets in the pool.
  idle_timeout: 20,
  // Recycle each connection after 30 minutes regardless of activity.
  max_lifetime: 1800,
  // Log and swallow connection errors so the pool self-heals instead of
  // crashing the process on a transient Docker network blip.
  onnotice: () => {},
});

export const db = drizzle(client, { schema });
