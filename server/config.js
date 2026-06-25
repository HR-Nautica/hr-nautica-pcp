import "dotenv/config";

function env(name) {
  return String(process.env[name] || "").trim();
}

export const config = {
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || "127.0.0.1",
  database: {
    connectionString:
      env("DATABASE_URL") ||
      env("POSTGRES_URL") ||
      env("POSTGRES_PRISMA_URL") ||
      env("POSTGRES_URL_NON_POOLING")
  },
  supabase: {
    url: env("SUPABASE_URL") || env("VITE_SUPABASE_URL"),
    serviceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY"),
    anonKey: env("VITE_SUPABASE_ANON_KEY") || env("SUPABASE_ANON_KEY")
  },
  tinyToken: env("TINY_TOKEN")
};
