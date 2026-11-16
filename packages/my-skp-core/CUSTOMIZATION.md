# Local custom library

The TypeScript package used by the viewer lives at `packages/typescript`.

## Build

```bash
cd packages/my-skp-core/packages/typescript
npm ci
npm run build
```

The web app consumes it through the local dependency `skp-core-custom` in the
workspace root `package.json`.

## Where to customize

- `packages/typescript/src/parser.ts`: SKP container parsing
- `packages/typescript/src/model.ts`: model, definitions, instances, layers and scene baking
- `packages/typescript/src/geometry.ts`: faces, materials, UVs and triangulation inputs
- `packages/typescript/src/edge-flags.ts`: hidden, soft and smooth edge flags
- `packages/typescript/src/pages-dimensions.ts`: scenes/pages and dimensions

Keep the upstream MIT license in `LICENSE` when distributing this fork.
