import "dotenv/config";

export const config = {
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || "127.0.0.1",
  database: {
    connectionString: process.env.DATABASE_URL || ""
  },
  tinyToken: process.env.TINY_TOKEN || ""
};
