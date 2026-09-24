# Bopple Icons

This is a collection of icons used at Bopple.

## Usage

### React

Each size exports a React component per icon, named after the icon in PascalCase with an `Icon` suffix (`chevron-up` becomes `ChevronUpIcon`):

```jsx
import { ChevronUpIcon } from "@boppl/icons/react/16";
import { ChevronUpIcon } from "@boppl/icons/react/24";

<ChevronUpIcon className="icon" title="Expand" titleId="expand" />;
```

The 24x24 icons can be imported from `@boppl/icons/react/24`, the 16x16 icons can be imported from `@boppl/icons/react/16`.

Icons use an upper camel case naming convention and are always suffixed with the word `Icon`.

The components pass their props to the `<svg>`, including `ref`, and render a `<title>` when `title` is set. Only the icons you import end up in your bundle. React 19 or later is required.

### SVG

The raw SVGs are published by size, named without a prefix:

```js
import chevronUp16 from "@boppl/icons/svg/16/chevron-up.svg";
import chevronUp24 from "@boppl/icons/svg/24/chevron-up.svg";
```

## Adding icons

Add the SVGs to the folder for their size in `src/`, named with the size prefix, e.g. `src/16/ic16_<name>.svg`. The build optimizes them with [SVGO](https://svgo.dev/), writes them to `dist/svg/` without the prefix, and generates the React components in `dist/react/`. SVGO keeps each icon's size, `viewBox` and title, and prefixes its ids with the icon's name (e.g. `ic16-google-analytics__a`), so icons on the same page can't pick up each other's clip paths or gradients:

```bash
npm run build
```

It runs automatically when the package is packed or published, and `dist/` is not committed. The build will fail if two icons of the same size would get the same component name, e.g. `google-analytics` and `googleanalytics`.

A new size only needs a new folder in `src/` (e.g. `src/20/` with `ic20_<name>.svg` files), and is then available from `@boppl/icons/react/20` and `@boppl/icons/svg/20/<name>.svg`.

## Releasing

Releases are cut from `main` and need the [GitHub CLI](https://cli.github.com/).

```bash
npm run release <major|minor|patch>
```

This bumps `package.json`, regenerates `CHANGELOG.md` from the commits since the last release, commits and tags the new version, and pushes both. The tag triggers the Publish workflow, which publishes the package to GitHub Packages and creates the GitHub release, using the new version's section of `CHANGELOG.md` as the release notes. The script waits for the workflow and then checks that everything ended up on the new version.
