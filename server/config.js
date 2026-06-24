import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const accessPath = process.env.ACCESS_DB_PATH || path.join(root, "database", "pcp.accdb");

export const config = {
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || "127.0.0.1",
  database: {
    file: accessPath,
    connectionString: process.env.ACCESS_CONNECTION_STRING || ""
  },
  tinyToken: process.env.TINY_TOKEN || ""
};
