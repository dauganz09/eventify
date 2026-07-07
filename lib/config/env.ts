import { z } from "zod";

export const deploymentModeSchema = z.enum(["online", "local", "hybrid"]);
export const realtimeProviderSchema = z.enum(["supabase", "local", "none"]);

const appConfigSchema = z.object({
  deploymentMode: deploymentModeSchema.default("local"),
  realtimeProvider: realtimeProviderSchema.default("none"),
  databaseUrl: z.string().min(1),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export function getAppConfig(): AppConfig {
  return appConfigSchema.parse({
    deploymentMode: process.env.APP_DEPLOYMENT_MODE,
    realtimeProvider: process.env.REALTIME_PROVIDER,
    databaseUrl: process.env.DATABASE_URL,
  });
}

export function isOnlineMode() {
  return getAppConfig().deploymentMode === "online";
}
