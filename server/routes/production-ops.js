import { Router } from "express";
import { mutateManualProductionOrder } from "../database.js";

const router = Router();
const actor = req => String(req.get("x-pcp-user") || req.body?.actor || "").trim().slice(0, 100);

async function mutate(req, res, next, action) {
  try {
    const result = await mutateManualProductionOrder(action, req.params.id, req.body?.data, req.body?.expectedVersion, actor(req));
    if (!result) return res.status(404).json({ ok: false, error: "Ordem de producao nao encontrada." });
    return res.status(action === "create" ? 201 : 200).json({ ok: true, ...result });
  } catch (error) {
    if ([409, 503].includes(error.status) || error instanceof TypeError || error instanceof RangeError) {
      return res.status(error.status || 400).json({ ok: false, code: error.code, error: error.message, currentVersion: error.currentVersion });
    }
    next(error);
  }
}

router.post("/", (req, res, next) => mutate(req, res, next, "create"));
router.patch("/:id", (req, res, next) => mutate(req, res, next, "update"));
router.delete("/:id", (req, res, next) => mutate(req, res, next, "delete"));

export default router;
