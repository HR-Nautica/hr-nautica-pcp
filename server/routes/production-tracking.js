import { Router } from "express";
import { reconcileProductionTracking } from "../database.js";

const router = Router();
router.post("/reconcile", async (req, res, next) => {
  try {
    const result = await reconcileProductionTracking(req.body?.data, req.body?.expectedVersions, String(req.auth?.username || "").slice(0, 100));
    res.status(201).json({ ok: true, ...result });
  } catch (error) {
    if ([409, 503].includes(error.status) || error instanceof RangeError) return res.status(error.status || 400).json({ ok: false, code: error.code, error: error.message, currentVersion: error.currentVersion });
    next(error);
  }
});
export default router;
