import { Router } from "express";
import { config } from "../config.js";

const router = Router();
router.get("/produtos/estoque", (_req, res) => {
  res.json({
    ok: true,
    enabled: Boolean(config.tinyToken),
    total: 0,
    produtos: [],
    mensagem: config.tinyToken
      ? "Integracao Tiny configurada; consulta pendente de homologacao."
      : "Integracao Tiny desativada no modo local."
  });
});
router.get("/produtos/entradas-previstas", (_req, res) => {
  res.json({ ok: true, enabled: Boolean(config.tinyToken), total: 0, entradas: [] });
});
router.get("/produtos/saidas", (_req, res) => {
  res.json({ ok: true, enabled: Boolean(config.tinyToken), total: 0, notas: [] });
});
router.post("/vini/sincronizar", (_req, res) => {
  res.status(503).json({ ok: false, error: "Sincronizacao externa indisponivel sem internet." });
});
router.get("/vini/status", (_req, res) => {
  res.json({ ok: true, enabled: false, mode: "offline" });
});

export default router;
