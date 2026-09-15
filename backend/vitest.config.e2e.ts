import { defineConfig, mergeConfig } from 'vitest/config';

import sharedConfig from './vitest.shared.js';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ['test/**/*.e2e-spec.ts'],
      setupFiles: ['./test/setup-env.ts'],
      // Testes e2e sobem a aplicação inteira: rodar em série evita disputa por
      // porta, banco e filas.
      fileParallelism: false,
      hookTimeout: 30_000,
      testTimeout: 30_000,
    },
  }),
);
