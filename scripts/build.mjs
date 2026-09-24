// Builds the published icons into dist/, one folder per size in src/:
//
//   dist/svg/16/chevron-up.svg      the SVG, optimized, without the size prefix
//   dist/react/16/ChevronUpIcon.js  a React component for it
//   dist/react/16/index.js          every component for the size, plus types
//
// Runs automatically before the package is packed or published (prepack).

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { transform as svgr } from "@svgr/core";
import { transform as esbuild } from "esbuild";
import { optimize } from "svgo";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = join(root, "src");
const dist = join(root, "dist");

// Same output the apps used with vite-plugin-svgr, so the icons render as before.
// React 19 passes ref as a regular prop, so it reaches the <svg> through the
// props spread without wrapping every icon in forwardRef.
const svgrOptions = {
  plugins: ["@svgr/plugin-jsx"],
  jsxRuntime: "automatic",
  exportType: "named",
  titleProp: true,
  svgo: false,
};

// Minified apart from identifiers, so component names still show in React DevTools
const esbuildOptions = {
  loader: "jsx",
  jsx: "automatic",
  format: "esm",
  minifyWhitespace: true,
  minifySyntax: true,
};

const types = `import type { JSX, SVGProps } from "react";

type Icon = (props: SVGProps<SVGSVGElement> & { title?: string; titleId?: string }) => JSX.Element;
`;

// chevron-up -> ChevronUpIcon
const toComponentName = (name) =>
  name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join("") + "Icon";

// SVGO's default preset keeps the viewBox, dimensions and titles. prefixIds gives
// each icon its own ids (e.g. ic16-google-analytics__a), as several icons share ids
// like "a" and would pick up each other's clip paths when inlined on the same page.
const optimizeSvg = (svg, id) =>
  optimize(svg, {
    multipass: true,
    plugins: ["preset-default", "sortAttrs", { name: "prefixIds", params: { prefix: id } }],
  }).data;

// React creates <svg> in the SVG namespace itself, so the default xmlns is dead weight
const toComponent = async (svg, componentName) => {
  const jsx = await svgr(
    optimize(svg, { plugins: ["removeXMLNS"] }).data,
    { ...svgrOptions, namedExport: componentName },
    { componentName },
  );
  const { code } = await esbuild(jsx, esbuildOptions);
  return code;
};

const sizes = readdirSync(src, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

rmSync(dist, { recursive: true, force: true });

for (const size of sizes) {
  const prefix = `ic${size}_`;
  const svgOutput = join(dist, "svg", size);
  const reactOutput = join(dist, "react", size);

  mkdirSync(svgOutput, { recursive: true });
  mkdirSync(reactOutput, { recursive: true });

  const icons = [];
  for (const file of readdirSync(join(src, size)).sort()) {
    if (file.startsWith(".")) continue;

    if (!file.startsWith(prefix) || !file.endsWith(".svg")) {
      console.warn(`Skipping src/${size}/${file}, expected ${prefix}<name>.svg`);
      continue;
    }

    const name = file.slice(prefix.length, -".svg".length);
    const componentName = toComponentName(name);

    // Names that only differ in punctuation or case (e.g. google-analytics and
    // googleanalytics) would overwrite each other on case-insensitive file systems
    const clash = icons.find(
      (icon) => icon.componentName.toLowerCase() === componentName.toLowerCase(),
    );
    if (clash || !/^[A-Z]/.test(componentName)) {
      throw new Error(
        `src/${size}/${file} can't become ${componentName}${clash ? `, it clashes with ${clash.file}` : ""}`,
      );
    }

    icons.push({ file, name, componentName });
  }

  await Promise.all(
    icons.map(async ({ file, name, componentName }) => {
      const svg = optimizeSvg(readFileSync(join(src, size, file), "utf8"), `ic${size}-${name}`);
      writeFileSync(join(svgOutput, `${name}.svg`), svg);
      writeFileSync(
        join(reactOutput, `${componentName}.js`),
        await toComponent(svg, componentName),
      );
    }),
  );

  writeFileSync(
    join(reactOutput, "index.js"),
    icons
      .map(({ componentName }) => `export { ${componentName} } from "./${componentName}.js";\n`)
      .join(""),
  );
  writeFileSync(
    join(reactOutput, "index.d.ts"),
    types +
      "\n" +
      icons.map(({ componentName }) => `export declare const ${componentName}: Icon;\n`).join(""),
  );

  console.log(`Built ${icons.length} icons into dist/svg/${size}/ and dist/react/${size}/`);
}
