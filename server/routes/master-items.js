import { Router } from "express";
import { addMasterItemAlias, getMasterItem, listMasterItemAliases, listMasterItems, MasterItemError, resolveMasterItemCode, createMasterItem, updateMasterItem } from "../master-items.js";

const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function actor(req) { return String(req.auth?.username || "").slice(0, 100); }
function adminOnly(req, res, next) {
  if (req.auth?.role !== "admin") return res.status(403).json({ ok: false, code: "MASTER_ITEM_FORBIDDEN", error: "Permissao de administrador obrigatoria." });
  return next();
}
function validId(value, res) {
  if (UUID.test(String(value || ""))) return true;
  res.status(400).json({ ok: false, code: "MASTER_ITEM_VALIDATION", error: "UUID de Item Mestre invalido." });
  return false;
}
function positiveInteger(value, name, res) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(String(value)) || Number(value) < 1) { res.status(400).json({ ok: false, code: "MASTER_ITEM_VALIDATION", error: `${name} invalido.` }); return null; }
  return Number(value);
}
function replyError(error, res, next) {
  if (error instanceof MasterItemError) return res.status(error.status).json({ ok: false, code: error.code, error: error.message, currentVersion: error.currentVersion });
  if (["08000", "08001", "08003", "08006", "57P01"].includes(error?.code)) return res.status(503).json({ ok: false, code: "DATABASE_UNAVAILABLE", error: "Banco indisponivel." });
  return next(error);
}
function write(res, next, work, created = false) {
  work.then((result) => res.status(created && !result.idempotent ? 201 : 200).json({ ok: true, ...result })).catch((error) => replyError(error, res, next));
}

router.use(adminOnly);

router.get("/resolve", async (req, res, next) => {
  try {
    if (!req.query.namespace || !req.query.code) return res.status(400).json({ ok: false, code: "MASTER_ITEM_VALIDATION", error: "namespace e code sao obrigatorios." });
    const item = await resolveMasterItemCode(req.query.namespace, req.query.code);
    if (!item) return res.status(404).json({ ok: false, code: "MASTER_ITEM_NOT_FOUND", error: "Codigo nao encontrado." });
    return res.json({ ok: true, item });
  } catch (error) { return replyError(error, res, next); }
});

router.post("/", (req, res, next) => write(res, next, createMasterItem(req.body?.data, { eventKey: req.body?.eventKey, actor: actor(req) }), true));

router.get("/", async (req, res, next) => {
  const page = positiveInteger(req.query.page, "page", res); if (page === null) return;
  const limit = positiveInteger(req.query.limit, "limit", res); if (limit === null) return;
  if (limit !== undefined && limit > 100) return res.status(400).json({ ok: false, code: "MASTER_ITEM_VALIDATION", error: "limit invalido." });
  try { return res.json({ ok: true, ...(await listMasterItems({ query: req.query.query || "", family: req.query.family, status: req.query.status, page, limit })) }); } catch (error) { return replyError(error, res, next); }
});

router.get("/:id/aliases", async (req, res, next) => {
  if (!validId(req.params.id, res)) return;
  try { return res.json({ ok: true, aliases: await listMasterItemAliases(req.params.id) }); } catch (error) { return replyError(error, res, next); }
});
router.post("/:id/aliases", (req, res, next) => {
  if (!validId(req.params.id, res)) return;
  write(res, next, addMasterItemAlias(req.params.id, req.body?.data, { eventKey: req.body?.eventKey, actor: actor(req) }), true);
});
router.get("/:id", async (req, res, next) => {
  if (!validId(req.params.id, res)) return;
  try { const item = await getMasterItem(req.params.id); return item ? res.json({ ok: true, item }) : res.status(404).json({ ok: false, code: "MASTER_ITEM_NOT_FOUND", error: "Item Mestre nao encontrado." }); } catch (error) { return replyError(error, res, next); }
});
router.patch("/:id", (req, res, next) => {
  if (!validId(req.params.id, res)) return;
  write(res, next, updateMasterItem(req.params.id, req.body?.data, { expectedVersion: req.body?.expectedVersion, eventKey: req.body?.eventKey, actor: actor(req) }));
});

export default router;
