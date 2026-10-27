import { Router } from "express";
import { createInventoryMovement, mutateInventory } from "../database.js";

const router = Router();
const actor = req => String(req.auth?.username || "").slice(0, 100);
const respond = (res, next, work, status = 200) => work.then(result => result ? res.status(status).json({ ok: true, ...result }) : res.status(404).json({ ok: false, error: "Material nao encontrado." })).catch(error => {
  if ([409, 503].includes(error.status) || error instanceof RangeError) return res.status(error.status || 400).json({ ok: false, code: error.code, error: error.message, currentVersion: error.currentVersion });
  next(error);
});
router.post("/materials", (req, res, next) => respond(res, next, mutateInventory("create", "", req.body?.data, req.body?.expectedVersions, actor(req)), 201));
router.patch("/materials/:id", (req, res, next) => respond(res, next, mutateInventory("update", req.params.id, req.body?.data, req.body?.expectedVersions, actor(req))));
router.delete("/materials/:id", (req, res, next) => respond(res, next, mutateInventory("delete", req.params.id, {}, req.body?.expectedVersions, actor(req))));
router.post("/movements", (req, res, next) => respond(res, next, createInventoryMovement(req.body?.data, req.body?.expectedVersions, actor(req)), 201));
export default router;
