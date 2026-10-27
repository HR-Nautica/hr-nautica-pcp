export function createMigrationGate(requiredVersions, getDatabaseStatus) {
  const required = new Set(requiredVersions.map(Number));

  return function migrationGate(_req, _res, next) {
    const status = getDatabaseStatus();
    const pending = (status?.pending || []).map(Number).filter((version) => required.has(version));
    if (!pending.length) return next();

    const error = new Error(`Funcionalidade indisponível enquanto migrations V${pending.join(", V")} estiverem pendentes.`);
    error.code = "MIGRATIONS_PENDING";
    error.pendingMigrations = pending;
    next(error);
  };
}
