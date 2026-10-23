// Builds site/index.html: a single page to search and browse every icon, like
// heroicons.com. It embeds the optimized SVGs from dist/svg, so run the build first
// (`npm run build:site` does both). The page itself is scripts/site.html.

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const svgDist = join(root, "dist", "svg");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// The site deploys on every push to main, so it can show icons that aren't in the
// published version yet. The footer says so, naming the commit it was built from,
// unless this is the release commit itself, where the version is the whole story.
const git = (...args) => {
  try {
    return execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return ""; // no git, or no repository: fall back to the version alone
  }
};

// Vercel sets these during the build; git answers locally
const sha = process.env.VERCEL_GIT_COMMIT_SHA || git("rev-parse", "HEAD");
const subject = (process.env.VERCEL_GIT_COMMIT_MESSAGE || git("log", "-1", "--pretty=%s")).split(
  "\n",
)[0];
// npm version commits exactly this, so matching it means the page is the released icons
const dirty = !process.env.VERCEL && git("status", "--porcelain") !== "";
const released = !dirty && subject.trim() === `chore: release v${version}`;

// Same naming as the build: chevron-up -> ChevronUpIcon
const toComponentName = (name) =>
  name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join("") + "Icon";

// Icons with stroke settings but no stroke colour of their own get it from CSS
const isStroked = (svg) =>
  /stroke-(width|linecap|linejoin)/.test(svg) && !/\sstroke="(?!none)/.test(svg);

// The drawing size, from width and height, or the viewBox when they're missing
const dimensions = (svg) => {
  const tag = svg.match(/<svg\b[^>]*>/)[0];
  const attr = (name) => parseFloat(tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]);
  const viewBox = tag
    .match(/viewBox="([^"]*)"/)?.[1]
    .split(/[\s,]+/)
    .map(Number);
  return [attr("width") || viewBox?.[2] || 24, attr("height") || viewBox?.[3] || 24];
};

// Numeric sizes first, smallest first, then named groups such as misc
const sizes = readdirSync(svgDist)
  .filter((group) => !group.startsWith("."))
  .sort((a, b) =>
    /^\d+$/.test(a) && /^\d+$/.test(b)
      ? a - b
      : /^\d+$/.test(a)
        ? -1
        : /^\d+$/.test(b)
          ? 1
          : a.localeCompare(b),
  );

const icons = new Map();
for (const size of sizes) {
  for (const file of readdirSync(join(svgDist, size)).filter((f) => f.endsWith(".svg"))) {
    const name = file.slice(0, -".svg".length);
    const svg = readFileSync(join(svgDist, size, file), "utf8").trim();
    if (!icons.has(name))
      icons.set(name, { name, component: toComponentName(name), svgs: {}, dims: {}, stroked: {} });
    icons.get(name).svgs[size] = svg;
    icons.get(name).dims[size] = dimensions(svg);
    if (isStroked(svg)) icons.get(name).stroked[size] = true;
  }
}

const data = {
  version,
  released,
  commit: released ? "" : sha.slice(0, 7),
  generated: new Date().toISOString().slice(0, 10),
  sizes,
  icons: [...icons.values()].sort((a, b) => a.name.localeCompare(b.name)),
};

// Escaping < keeps any "</script>" inside the SVGs from ending the data block
const json = JSON.stringify(data).replace(/</g, "\\u003c");
const page = readFileSync(join(root, "scripts", "site.html"), "utf8").replace(
  "/*__ICON_DATA__*/",
  () => json,
);

// A full document for hosting and opening the file directly. With --fragment,
// only the page itself, for hosts that add their own <head> (a claude.ai artifact).
const [head, body] = page.split(/\n(?=<div class="page">)/);
const html = process.argv.includes("--fragment")
  ? page
  : `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
</head>
<body>
${body}
</body>
</html>
`;

mkdirSync(join(root, "site"), { recursive: true });
writeFileSync(join(root, "site", "index.html"), html);

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(
  `Built site/index.html: ${data.icons.length} icons in ${sizes.length} groups (${sizes.join(", ")}), ${kb} KB`,
);
