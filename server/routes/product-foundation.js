import { Router } from "express";

import { importNormalizedProductWorkbook, preflightNormalizedProductWorkbook, ProductImportError } from "../product-foundation-import.js";
import { importComponentRoutingWorkbook, preflightComponentRoutingWorkbook, ComponentRoutingImportError } from "../component-routing-import.js";

const router = Router();

function adminOnly(req, res, next) {
  if (req.auth?.role !== "admin") return res.status(403).json({ ok: false, code: "PRODUCT_FOUNDATION_FORBIDDEN", error: "Permissao de administrador obrigatoria." });
  return next();
}

function workbook(req) {
  const encoded = String(req.body?.fileBase64 || "");
  if (!encoded || encoded.length > 20_000_000 || !/^[A-Za-z0-9+/=]+$/.test(encoded)) throw new ProductImportError("Arquivo da importacao ausente ou invalido.");
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length || buffer.length > 15_000_000) throw new ProductImportError("Arquivo da importacao excede o limite permitido.");
  return buffer;
}

function reply(error, res, next) {
  if (error instanceof ProductImportError) return res.status(error.status).json({ ok: false, code: error.code, error: error.message, details: error.details });
  if (error instanceof ComponentRoutingImportError) return res.status(error.status).json({ ok: false, code: error.code, error: error.message, details: error.details });
  if (["08000", "08001", "08003", "08006", "57P01"].includes(error?.code)) return res.status(503).json({ ok: false, code: "DATABASE_UNAVAILABLE", error: "Banco indisponivel." });
  return next(error);
}

router.use(adminOnly);

router.post("/validate", async (req, res, next) => {
  try {
    const result = await preflightNormalizedProductWorkbook(workbook(req), { productsOnly:req.body?.productsOnly===true, defaultUnit:req.body?.defaultUnit==='UN'?'UN':undefined });
    return res.json({ ok: true, ...result });
  } catch (error) { return reply(error, res, next); }
});

router.post("/import", async (req, res, next) => {
  try {
    const result = await importNormalizedProductWorkbook(workbook(req), {
      sourceName: String(req.body?.fileName || "BOMs_normalizadas_unificadas.xlsx"),
      expectedChecksum: String(req.body?.expectedChecksum||''),
      productsOnly:req.body?.productsOnly===true,
      defaultUnit:req.body?.defaultUnit==='UN'?'UN':undefined,
      actor: String(req.auth?.username || "").slice(0, 100)
    });
    return res.status(result.idempotent ? 200 : 201).json({ ok: true, ...result });
  } catch (error) { return reply(error, res, next); }
});

router.post("/component-routing/validate", async (req, res, next) => {
  try { return res.json({ ok: true, ...await preflightComponentRoutingWorkbook(workbook(req)) }); }
  catch (error) { return reply(error, res, next); }
});

router.post("/component-routing/import", async (req, res, next) => {
  try {
    const result = await importComponentRoutingWorkbook(workbook(req), {
      sourceName: String(req.body?.fileName || "fabri1_arvore_com_chave_familia.xlsx"),
      expectedChecksum: String(req.body?.expectedChecksum || ""),
      actor: String(req.auth?.username || "").slice(0, 100)
    });
    return res.status(result.idempotent ? 200 : 201).json({ ok: true, ...result });
  } catch (error) { return reply(error, res, next); }
});

export default router;
