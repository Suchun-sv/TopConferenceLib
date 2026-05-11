import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

/** Long-lived pool for the Node runtime (Next.js server, MCP server, scripts). */
const client = postgres(connectionString, {
  prepare: false,
  max: 10,
});

export const db = drizzle(client, { schema });
export { schema };
export * from "./schema.js";
