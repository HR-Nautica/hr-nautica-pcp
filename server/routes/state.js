import { Router } from "express";
import { deleteState, getStateSnapshot, upsertState } from "../database.js";

const router = Router();
const KEY_PATTERN = /^hrn_[a-zA-Z0-9_]+$/;

router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

function actorFromRequest(req) {
  return String(req.get("x-pcp-user") || req.body?.actor || "").trim().slice(0, 100);
}

router.get("/", async (req, res, next) => {
  try {
    const requestedRevision = Number(req.query.since || 0);
    const snapshot = await getStateSnapshot(requestedRevision);
    return res.json({ ok: true, ...snapshot });
  } catch (error) {
    next(error);
  }
});

router.put("/:key", async (req, res, next) => {
  const { key } = req.params;
  if (!KEY_PATTERN.test(key)) {
    return res.status(400).json({ ok: false, error: "Chave invalida." });
  }

  try {
    const result = await upsertState(
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

router.delete("/:key", async (req, res, next) => {
  const { key } = req.params;
  if (!KEY_PATTERN.test(key)) {
    return res.status(400).json({ ok: false, error: "Chave invalida." });
  }

  try {
    const result = await deleteState(
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

export default router;
