import { Router } from "express";
import { deleteState, getStateSnapshot, upsertState } from "../database.js";
import { genericStateWriteDecision } from "../state-write-policy.js";

const KEY_PATTERN = /^hrn_[a-zA-Z0-9_]+$/;

export function createStateRouter(storage = { deleteState, getStateSnapshot, upsertState }) {
const router = Router();
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

function actorFromRequest(req) {
  return String(req.auth?.username || "").slice(0, 100);
}

function rejectForbiddenWrite(req, res, next) {
  if (!KEY_PATTERN.test(req.params.key)) {
    return res.status(400).json({ ok: false, error: "Chave invalida." });
  }
  const decision = genericStateWriteDecision(req.params.key, req.method);
  if (decision.allowed) return next();
  return res.status(403).json({
    ok: false,
    code: decision.code,
    error: "Esta chave exige uma API de negocio especifica.",
    specificApi: decision.specificApi,
  });
}

router.get("/", async (req, res, next) => {
  try {
    const requestedRevision = Number(req.query.since || 0);
    const snapshot = await storage.getStateSnapshot(requestedRevision);
    return res.json({ ok: true, ...snapshot });
  } catch (error) {
    next(error);
  }
});

router.put("/:key", rejectForbiddenWrite, async (req, res, next) => {
  const { key } = req.params;
  if (!KEY_PATTERN.test(key)) {
    return res.status(400).json({ ok: false, error: "Chave invalida." });
  }

  try {
    const result = await storage.upsertState(
      key,
      req.body.value,
      Number(req.body.expectedVersion || 0),
      actorFromRequest(req)
    );
    return res.json({ ok: true, ...result });
  } catch (error) {
    if (error.status === 409) {
      return res.status(409).json({
        ok: false,
        code: "VERSION_CONFLICT",
        error: "Os dados foram alterados por outro usuario.",
        currentVersion: error.currentVersion
      });
    }
    next(error);
  }
});

router.delete("/:key", rejectForbiddenWrite, async (req, res, next) => {
  const { key } = req.params;
  if (!KEY_PATTERN.test(key)) {
    return res.status(400).json({ ok: false, error: "Chave invalida." });
  }

  try {
    const result = await storage.deleteState(
      key,
      Number(req.body.expectedVersion || 0),
      actorFromRequest(req)
    );
    return res.json({ ok: true, ...result });
  } catch (error) {
    if (error.status === 409) {
      return res.status(409).json({
        ok: false,
        code: "VERSION_CONFLICT",
        error: "Os dados foram alterados por outro usuario.",
        currentVersion: error.currentVersion
      });
    }
    next(error);
  }
});

return router;
}

export default createStateRouter();
