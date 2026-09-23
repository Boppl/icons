# Bopple Icons

This is a collection of icons used at Bopple.

## Releasing

Releases are cut from `main` and need the [GitHub CLI](https://cli.github.com/).

```bash
npm run release <major|minor|patch>
```

This bumps `package.json`, commits and tags the new version, and pushes both. The tag triggers the Publish workflow, which publishes the package to GitHub Packages and creates the GitHub release. The script waits for the workflow and then checks that everything ended up on the new version.
