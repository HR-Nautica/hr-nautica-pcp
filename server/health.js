import { normalizedReleaseSha } from "./release.js";

export function createHealthHandler({ databaseHealth, releaseSha }) {
  return async function healthHandler(_req, res, next) {
    try {
      const databaseTime = await databaseHealth();
      res.setHeader("Cache-Control", "no-store");
      res.json({
        ok: true,
        service: "HR Nautica PCP",
        release: normalizedReleaseSha(releaseSha),
        databaseTime
      });
    } catch (error) {
      next(error);
    }
  };
}
