import { Router } from "express";
import {
  createFundicaoOrder,
  deleteFundicaoOrder,
  finalizeFundicaoOrder,
  getFundicaoOrders,
  updateFundicaoOrder
} from "../database.js";

const router = Router();

router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  next();
});

const actor = req => String(req.auth?.username || "").slice(0, 100);

router.get("/", async (_req, res, next) => {
  try {
    const result = await getFundicaoOrders();
    return res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const result = await createFundicaoOrder(req.body, actor(req));
    return res.status(201).json({ ok: true, ...result });
  } catch (error) {
    if ([409, 503].includes(error.status) || error instanceof TypeError || error instanceof RangeError) {
      return res.status(error.status || 400).json({ ok: false, code: error.code, error: error.message });
    }
    next(error);
  }
});

router.post("/:id/finalizar", async (req, res, next) => {
  try {
    const result = await finalizeFundicaoOrder(req.params.id, req.body, actor(req));
    if (!result) return res.status(404).json({ ok: false, error: "OP de fundição não encontrada." });
    return res.json({ ok: true, ...result });
  } catch (error) {
    if ([409, 503].includes(error.status) || error instanceof TypeError || error instanceof RangeError) {
      return res.status(error.status || 400).json({ ok: false, code: error.code, error: error.message });
    }
    next(error);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const result = await updateFundicaoOrder(req.params.id, req.body, actor(req));
    if (!result) return res.status(404).json({ ok: false, error: "OP de fundição não encontrada." });
    return res.json({ ok: true, ...result });
  } catch (error) {
    if ([409, 503].includes(error.status) || error instanceof TypeError || error instanceof RangeError) {
      return res.status(error.status || 400).json({ ok: false, code: error.code, error: error.message });
    }
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const result = await deleteFundicaoOrder(req.params.id, actor(req));
    if (!result) return res.status(404).json({ ok: false, error: "OP de fundição não encontrada." });
    return res.json({ ok: true, ...result });
  } catch (error) {
    if ([409, 503].includes(error.status) || error instanceof TypeError || error instanceof RangeError) {
      return res.status(error.status || 400).json({ ok: false, code: error.code, error: error.message });
    }
    next(error);
  }
});

export default router;
