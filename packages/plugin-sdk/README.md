# @grainery/plugin-sdk

Internal TypeScript SDK package for Grainery plugin authors.

The canonical runtime and type surface lives in `src/plugins/sdk.ts`. This package exposes that surface under the stable package name `@grainery/plugin-sdk` so generated plugins can use normal TypeScript imports.

For unbundled plugins, prefer type-only imports:

```ts
import type { GraineryPlugin } from '@grainery/plugin-sdk';
```

Runtime helpers such as `definePlugin` are available for bundled plugin projects.
