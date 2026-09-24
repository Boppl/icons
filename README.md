# Bopple Icons

This is a collection of icons used at Bopple.

## Usage

Icons are published by size, named without a prefix:

```js
import ChevronUp16 from "@boppl/icons/svg/16/chevron-up.svg";
import ChevronUp24 from "@boppl/icons/svg/24/chevron-up.svg";
```

## Adding icons

Add the SVGs to the folder for their size in `src/`, named with the size prefix, e.g. `src/16/ic16_<name>.svg`. The build copies them into `dist/svg/` without the prefix, e.g. `dist/svg/16/<name>.svg`:

```bash
npm run build
```

It runs automatically when the package is packed or published, and `dist/` is not committed. A new size only needs a new folder in `src/` (e.g. `src/20/` with `ic20_<name>.svg` files), and is then imported as `@boppl/icons/svg/20/<name>.svg`.

## Releasing

Releases are cut from `main` and need the [GitHub CLI](https://cli.github.com/).

```bash
npm run release <major|minor|patch>
```

This bumps `package.json`, regenerates `CHANGELOG.md` from the commits since the last release, commits and tags the new version, and pushes both. The tag triggers the Publish workflow, which publishes the package to GitHub Packages and creates the GitHub release, using the new version's section of `CHANGELOG.md` as the release notes. The script waits for the workflow and then checks that everything ended up on the new version.
