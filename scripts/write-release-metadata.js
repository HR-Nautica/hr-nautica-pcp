import fs from "node:fs/promises";
import path from "node:path";

const sha = String(process.env.APP_COMMIT_SHA || "development").trim().toLowerCase();
if (sha !== "development" && !/^[0-9a-f]{40}$/.test(sha)) {
  throw new Error("APP_COMMIT_SHA deve ser um SHA Git completo de 40 caracteres.");
}

const directory = path.resolve("dist");
await fs.mkdir(directory, { recursive: true });
await fs.writeFile(path.join(directory, "release.json"), `${JSON.stringify({ release: sha })}\n`, "utf8");
await fs.writeFile(path.join(directory, "release.js"), `window.PCP_RELEASE_SHA=${JSON.stringify(sha)};\n`, "utf8");
