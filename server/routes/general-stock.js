import { Router } from "express";
import { getGeneralStock } from "../general-stock.js";

const router = Router();

router.get("/", async (_req, res, next) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    return res.json({ ok: true, ...(await getGeneralStock()) });
  } catch (error) {
    return next(error);
  }
});

export default router;
