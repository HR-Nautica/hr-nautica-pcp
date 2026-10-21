import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  return ({
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        headers: { "x-hrn-proxy-secret": environment.PROXY_SHARED_SECRET || "" }
      }
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
  });
});
