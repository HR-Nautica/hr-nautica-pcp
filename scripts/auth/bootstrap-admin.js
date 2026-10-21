import argon2 from "argon2";

import { closeDatabase, transaction } from "../../server/database.js";

const username = String(process.env.INITIAL_ADMIN_USERNAME || "lucas").trim().toLowerCase();
const temporaryPassword = String(process.env.INITIAL_ADMIN_PASSWORD || "");
delete process.env.INITIAL_ADMIN_PASSWORD;

if (!/^[a-z0-9._-]{1,64}$/.test(username)) throw new Error("INITIAL_ADMIN_USERNAME invÃ¡lido.");
if (!temporaryPassword) throw new Error("Defina INITIAL_ADMIN_PASSWORD somente no ambiente do processo.");

try {
  const existing = await transaction(async (client) => {
    const result = await client.query("SELECT id FROM public.auth_users WHERE username = $1", [username]);
    return result.rows[0] || null;
  });

  if (existing) {
    console.log(`Administrador ${username} jÃ¡ existe; nenhuma credencial foi alterada.`);
  } else {
    const passwordHash = await argon2.hash(temporaryPassword, { type: argon2.argon2id });
    await transaction((client) => client.query(
      `INSERT INTO public.auth_users
         (username, password_hash, role, must_change_password, active)
       VALUES ($1, $2, 'admin', true, true)
       ON CONFLICT (username) DO NOTHING`,
      [username, passwordHash]
    ));
    console.log(`Administrador ${username} criado com troca obrigatÃ³ria de senha.`);
  }
} finally {
  await closeDatabase();
}
