const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;

export function normalizedReleaseSha(value) {
  const candidate = String(value || "").trim().toLowerCase();
  return FULL_GIT_SHA.test(candidate) ? candidate : "development";
}

export function createReleaseGuard(configuredSha) {
  const releaseSha = normalizedReleaseSha(configuredSha);
  return function releaseGuard(req, res, next) {
    res.setHeader("X-HRN-Release-Sha", releaseSha);
    if (releaseSha === "development" || !req.path.startsWith("/api/")) return next();

    const clientSha = String(req.get("x-hrn-release-sha") || "").trim().toLowerCase();
    if (clientSha !== releaseSha) {
      res.setHeader("X-HRN-Release-Mismatch", "1");
      return res.status(409).json({
        ok: false,
        code: "RELEASE_MISMATCH",
        error: "O ERP foi atualizado. Recarregue a pagina para continuar."
      });
    }
    return next();
  };
}
