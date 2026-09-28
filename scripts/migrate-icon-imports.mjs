// Migrates an app's icon imports to the @boppl/icons React components, in two steps:
//
// 1. svgr imports become one import per size:
//
//      import { ReactComponent as GooglePayIcon } from "@boppl/icons/svg/16/google-pay.svg"
//      import { ReactComponent as OrderIcon } from "@boppl/icons/ic16/ic16__bag.svg"
//      ->
//      import { BagIcon as OrderIcon, GooglePayIcon } from "@boppl/icons/react/16"
//
// 2. Aliases are dropped, renaming each use of the alias in the file to the icon's
//    own name (<OrderIcon /> becomes <BagIcon />). Uses are found with Babel's scope
//    analysis, so object keys, strings and unrelated variables are left alone. An
//    alias is kept when its icon's name is already taken in the file, e.g. BagIcon
//    from both react/16 and react/24, or a local variable called BagIcon.
//
// Usage, from anywhere: node migrate-icon-imports.mjs <app-dir> [--write]
// Without --write it only reports what it would change. Babel is loaded from the
// app's node_modules. Step 1 needs this repo's dist/ (run `npm run build` first).

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const app = args[0] && resolve(args[0]);
const write = args.includes("--write");
if (!app || !existsSync(join(app, "src"))) {
  console.error("Usage: node migrate-icon-imports.mjs <app-dir> [--write]");
  process.exit(1);
}

const require = createRequire(join(app, "package.json"));
const { parse } = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const iconsDist = fileURLToPath(new URL("../dist/react", import.meta.url));

// Same naming as the icons build: chevron-up -> ChevronUpIcon
const toComponentName = (name) =>
  name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join("") + "Icon";

// The components each size exports, read from the built package's types (step 1 only)
let components;
const exportsOf = (size) => {
  components ??= Object.fromEntries(
    readdirSync(iconsDist).map((s) => {
      const types = readFileSync(join(iconsDist, s, "index.d.ts"), "utf8");
      return [s, new Set([...types.matchAll(/export declare const (\w+)/g)].map((m) => m[1]))];
    }),
  );
  return components[size];
};

const sourceFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return /\.(jsx?|tsx?)$/.test(entry.name) ? [path] : [];
  });

const parseCode = (code, file) =>
  parse(code, {
    sourceType: "module",
    plugins: file.endsWith(".ts") ? ["typescript"] : file.endsWith(".tsx") ? ["typescript", "jsx"] : ["jsx"],
  });

// Applies [start, end, text] edits to code, last first so earlier offsets stay valid
const applyEdits = (code, edits) =>
  edits.sort((a, b) => b[0] - a[0]).reduce((out, [start, end, text]) => out.slice(0, start) + text + out.slice(end), code);

// Step 1: svgr imports -> one react import per size, keeping local names
const svgrImport =
  /^import \{ ReactComponent as (\w+) \} from "@boppl\/icons\/(?:svg\/(\d+)\/([\w-]+)|ic(\d+)\/ic\d+__([\w-]+))\.svg";?[^\S\n]*\n/gm;

const convertSvgrImports = (code, file, report) => {
  const matches = [...code.matchAll(svgrImport)];
  if (!matches.length) return code;

  const bySize = new Map();
  const replace = [];
  for (const match of matches) {
    const [line, local, svgSize, svgName, oldSize, oldName] = match;
    const size = svgSize ?? oldSize;
    const component = toComponentName(svgName ?? oldName);
    if (!exportsOf(size)?.has(component)) {
      report.missing.push(`${file}: ${svgName ?? oldName} (${size}px) has no ${component}`);
      continue;
    }
    if (!bySize.has(size)) bySize.set(size, { index: match.index, specifiers: [] });
    bySize.get(size).specifiers.push(component === local ? component : `${component} as ${local}`);
    replace.push({ index: match.index, length: line.length, size });
  }
  if (!replace.length) return code;

  const semicolon = matches[0][0].trimEnd().endsWith(";") ? ";" : "";
  report.converted += replace.length;
  return applyEdits(
    code,
    replace.map(({ index, length, size }) => {
      const group = bySize.get(size);
      const text =
        index === group.index
          ? `import { ${group.specifiers.join(", ")} } from "@boppl/icons/react/${size}"${semicolon}\n`
          : "";
      return [index, index + length, text];
    }),
  );
};

// Step 2: drop aliases, renaming their uses to the icon's own name
const removeAliases = (code, file, report) => {
  const ast = parseCode(code, file);
  const edits = [];
  const declarations = [];

  traverse(ast, {
    Program(program) {
      const iconImports = program
        .get("body")
        .filter((p) => p.isImportDeclaration() && /^@boppl\/icons\/react\/\d+$/.test(p.node.source.value));

      // Aliases, grouped by the name they would be renamed to
      const aliases = iconImports.flatMap((decl) =>
        decl.node.specifiers
          .filter((s) => s.type === "ImportSpecifier" && s.imported.name !== s.local.name)
          .map((s) => ({ decl, specifier: s, alias: s.local.name, name: s.imported.name, source: decl.node.source.value })),
      );
      const renamed = new Set();

      for (const entry of aliases) {
        const { alias, name, source } = entry;
        const binding = program.scope.getBinding(alias);
        const existing = program.scope.getBinding(name);

        // The name is taken, unless it's the same icon imported without an alias
        const sameIcon =
          existing?.path.isImportSpecifier() &&
          existing.path.parent.source.value === source &&
          existing.path.node.imported.name === name;
        const otherSource = aliases.some((a) => a.name === name && a.source !== source);
        // A nested variable called `name` would capture the renamed uses
        const shadowed = binding.referencePaths.some((ref) => ref.scope.getBinding(name) !== existing);

        if ((existing && !sameIcon) || otherSource || shadowed) {
          report.kept.push(`${file}: ${name} as ${alias}${shadowed ? " (shadowed)" : " (name taken)"}`);
          continue;
        }

        for (const ref of binding.referencePaths) {
          const { node, parent } = ref;
          if (parent.type === "ObjectProperty" && parent.shorthand && parent.value === node) {
            edits.push([parent.start, parent.end, `${alias}: ${name}`]);
          } else if (parent.type === "ExportSpecifier" && parent.local === node) {
            edits.push([parent.start, parent.end, parent.exported.name === alias ? `${name} as ${alias}` : `${name} as ${parent.exported.name}`]);
          } else {
            edits.push([node.start, node.end, name]);
          }
        }
        renamed.add(entry.specifier);
        report.renamed++;
      }

      // JSX closing tags aren't references, so rename those whose opening tag was
      program.traverse({
        JSXClosingElement(path) {
          const opening = path.parent.openingElement.name;
          const edit = opening.type === "JSXIdentifier" && edits.find(([start]) => start === opening.start);
          if (edit) edits.push([path.node.name.start, path.node.name.end, edit[2]]);
        },
      });

      // Rewrite each changed import declaration, dropping duplicate specifiers
      for (const decl of iconImports) {
        const specifiers = decl.node.specifiers;
        if (!specifiers.some((s) => renamed.has(s))) continue;
        const names = [...new Set(specifiers.map((s) => (renamed.has(s) || s.imported.name === s.local.name ? s.imported.name : `${s.imported.name} as ${s.local.name}`)))];
        const semicolon = code.slice(decl.node.start, decl.node.end).trimEnd().endsWith(";") ? ";" : "";
        declarations.push([decl.node.start, decl.node.end, `import { ${names.join(", ")} } from "${decl.node.source.value}"${semicolon}`]);
      }
    },
  });

  if (!edits.length && !declarations.length) return code;
  const updated = applyEdits(code, [...edits, ...declarations]);

  // Safety net: the result must parse, and no renamed alias may still be referenced
  try {
    const check = parseCode(updated, file);
    const gone = new Set(edits.map(([start, end]) => code.slice(start, end).split(":")[0].trim()));
    let leftover = null;
    traverse(check, {
      "Identifier|JSXIdentifier"(path) {
        if (gone.has(path.node.name) && !path.parentPath.isObjectProperty({ key: path.node }) && !path.parentPath.isMemberExpression({ property: path.node }) && !path.parentPath.isExportSpecifier()) leftover ??= path.node;
      },
    });
    if (leftover) throw new Error(`${leftover.name} is still used on line ${leftover.loc.start.line}`);
  } catch (error) {
    report.failed.push(`${file}: left unchanged, ${error.message}`);
    return code;
  }
  return updated;
};

const report = { files: 0, converted: 0, renamed: 0, kept: [], missing: [], failed: [] };

for (const path of sourceFiles(join(app, "src"))) {
  const file = relative(app, path);
  const original = readFileSync(path, "utf8");
  if (!original.includes("@boppl/icons")) continue;

  const updated = removeAliases(convertSvgrImports(original, file, report), file, report);
  if (updated === original) continue;

  report.files++;
  if (write) writeFileSync(path, updated);
}

console.log(
  `${write ? "Updated" : "Would update"} ${report.files} files: ${report.converted} svgr imports converted, ` +
    `${report.renamed} aliases renamed to the icon's name, ${report.kept.length} aliases kept.`,
);
for (const [title, lines] of [
  ["Aliases kept, as the icon's name is already taken in the file:", report.kept],
  ["Imports left unchanged, no matching component:", report.missing],
  ["Files left unchanged:", report.failed],
]) {
  if (lines.length) console.log(`\n${title}\n${lines.map((line) => `  ${line}`).join("\n")}`);
}
