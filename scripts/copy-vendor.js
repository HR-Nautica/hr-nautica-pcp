import fs from "node:fs/promises";
import path from "node:path";

const files = [
  ["node_modules/xlsx/dist/xlsx.full.min.js", "public/vendor/xlsx.full.min.js"],
  ["node_modules/chart.js/dist/chart.umd.js", "public/vendor/chart.umd.js"]
];
await fs.mkdir("public/vendor", { recursive: true });
for (const [source, target] of files) {
  await fs.copyFile(path.resolve(source), path.resolve(target));
  console.log(`${source} -> ${target}`);
}
