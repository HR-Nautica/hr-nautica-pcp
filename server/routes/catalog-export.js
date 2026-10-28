import { Router } from "express";
import { catalogExportWorkbook, getCatalogExport } from "../catalog-export.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const payload = await getCatalogExport();
    const stamp = payload.exportedAt.replace(/[:.]/g, "-");
    res.set("Cache-Control", "no-store");
    if (String(req.query.format || "json").toLowerCase() === "xlsx") {
      res.attachment(`hr-nautica-catalogos-${stamp}.xlsx`);
      res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      return res.send(catalogExportWorkbook(payload));
    }
    res.attachment(`hr-nautica-catalogos-${stamp}.json`);
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;

