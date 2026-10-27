import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bootstrap = await readFile(new URL("../../public/js/bootstrap.js", import.meta.url), "utf8");
const database = await readFile(new URL("../../public/js/db.js", import.meta.url), "utf8");

test("bootstrap nao recria nem limpa OPs, entradas ou saidas de Buchas", () => {
  assert.doesNotMatch(bootstrap, /ensureBuchasOpsSeed\s*\(/);
  assert.doesNotMatch(bootstrap, /ensureBuchasEntradasSeed\s*\(/);
  assert.doesNotMatch(database, /ensureBuchasOpsSeed\s*\(/);
  assert.doesNotMatch(database, /ensureBuchasEntradasSeed\s*\(/);
});
