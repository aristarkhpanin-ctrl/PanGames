import { build } from 'esbuild';

// Собираем один файл: @gavan/shared отдаётся исходниками на TypeScript,
// поэтому сервер бандлится, а не компилируется пофайлово.
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // Нативные и опциональные зависимости оставляем внешними: их резолвит Node в рантайме.
  packages: 'external',
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

console.info('Сервер собран в dist/index.js');
