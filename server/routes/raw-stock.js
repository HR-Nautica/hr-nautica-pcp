import { Router } from "express";
import { adjustRawMaterialStock, getRawMaterialStock } from "../database.js";

const router = Router();
const actor = req => String(req.get("x-pcp-user") || req.body?.actor || "").trim().slice(0, 100);

router.get("/", async (_req, res, next) => {
  try {
    res.json({ ok: true, ...(await getRawMaterialStock()) });
  } catch (error) { next(error); }
});

router.put("/:rawCode", async (req, res, next) => {
  try {
    const result = await adjustRawMaterialStock(req.params.rawCode, req.body?.quantity, req.body?.expectedVersion, actor(req));
    res.json({ ok: true, ...result });
  } catch (error) {
    if ([409, 503].includes(error.status) || error instanceof TypeError || error instanceof RangeError) {
      return res.status(error.status || 400).json({ ok: false, code: error.code, error: error.message, currentVersion: error.currentVersion });
    }
    next(error);
  }
});

export default router;
