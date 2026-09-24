// Builds the published icons into dist/svg/, one folder per size in src/,
// dropping the size prefix from each name, e.g. src/16/ic16_chevron-up.svg ->
// dist/svg/16/chevron-up.svg.
//
// Runs automatically before the package is packed or published (prepack).

import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = join(root, "src");
const dist = join(root, "dist");

const sizes = readdirSync(src, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

rmSync(dist, { recursive: true, force: true });

for (const size of sizes) {
  const prefix = `ic${size}_`;
  const output = join(dist, "svg", size);

  mkdirSync(output, { recursive: true });

  let count = 0;
  for (const file of readdirSync(join(src, size))) {
    if (file.startsWith(".")) continue;

    if (!file.startsWith(prefix) || !file.endsWith(".svg")) {
      console.warn(`Skipping src/${size}/${file}, expected ${prefix}<name>.svg`);
      continue;
    }

    copyFileSync(join(src, size, file), join(output, file.slice(prefix.length)));
    count++;
  }

  console.log(`Built ${count} icons into dist/svg/${size}/`);
}
