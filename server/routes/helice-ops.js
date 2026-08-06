import { Router } from "express";
import {
  finalizeHeliceProductionOrder,
  getHeliceProductionOrders,
  importHeliceProductionOrders
} from "../database.js";

const router = Router();

router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  next();
});

function actorFromRequest(req) {
  return String(req.get("x-pcp-user") || req.body?.actor || "").trim().slice(0, 100);
}

router.get("/", async (_req, res, next) => {
  try {
    const orders = await getHeliceProductionOrders();
    return res.json({ ok: true, orders, count: orders.length });
  } catch (error) {
    next(error);
  }
});

router.post("/import", async (req, res, next) => {
  try {
    const result = await importHeliceProductionOrders(req.body?.orders, actorFromRequest(req));
    return res.status(201).json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      return res.status(400).json({ ok: false, error: error.message });
    }
    next(error);
  }
});

router.patch("/:id/finalize", async (req, res, next) => {
  try {
    const order = await finalizeHeliceProductionOrder(req.params.id, actorFromRequest(req));
    if (!order) return res.status(404).json({ ok: false, error: "OP não encontrada." });
    return res.json({ ok: true, order });
  } catch (error) {
    if (error instanceof TypeError) {
      return res.status(400).json({ ok: false, error: error.message });
    }
    next(error);
  }
});

export default router;
