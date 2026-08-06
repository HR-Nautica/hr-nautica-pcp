import { Router } from "express";
import { getAnalysisTempRows, replaceAnalysisTempRows } from "../database.js";

const router = Router();

router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  next();
});

router.get("/", async (_req, res, next) => {
  try {
    const rows = await getAnalysisTempRows();
    return res.json({ ok: true, rows, count: rows.length });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const actor = String(req.get("x-pcp-user") || req.body?.actor || "").trim().slice(0, 100);
    const result = await replaceAnalysisTempRows(req.body?.rows, actor);
    return res.status(201).json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      return res.status(400).json({ ok: false, error: error.message });
    }
    next(error);
  }
});

export default router;
