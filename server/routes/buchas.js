import { Router } from "express";
import { createBuchaEntry, createBuchaOutput, getBuchasStock, transitionBuchaEntry } from "../database.js";

const router = Router();
const actor = req => String(req.auth?.username || "").slice(0, 100);

router.get("/stock", async (_req, res, next) => {
  try { res.json({ ok: true, ...(await getBuchasStock()) }); } catch (error) { next(error); }
});

router.post("/entries", async (req, res, next) => {
  try {
    res.status(201).json({ ok: true, ...(await createBuchaEntry(req.body?.data, req.body?.expectedVersions, actor(req))) });
  } catch (error) {
    if ([409, 503].includes(error.status) || error instanceof RangeError) return res.status(error.status || 400).json({ ok: false, code: error.code, error: error.message, currentVersion: error.currentVersion });
    next(error);
  }
});

router.post("/entries/:id/transition", async (req, res, next) => {
  try {
    res.status(201).json({ ok: true, ...(await transitionBuchaEntry(req.params.id, req.body?.data, req.body?.expectedVersions, actor(req))) });
  } catch (error) {
    if ([409, 503].includes(error.status) || error instanceof RangeError) return res.status(error.status || 400).json({ ok: false, code: error.code, error: error.message, currentVersion: error.currentVersion });
    next(error);
  }
});

router.post("/outputs", async (req, res, next) => {
  try {
    res.status(201).json({ ok: true, ...(await createBuchaOutput(req.body?.data, req.body?.expectedVersions, actor(req))) });
  } catch (error) {
    if ([409, 503].includes(error.status) || error instanceof RangeError) return res.status(error.status || 400).json({ ok: false, code: error.code, error: error.message, currentVersion: error.currentVersion });
    next(error);
  }
});

export default router;
