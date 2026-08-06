import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // .env один на весь монорепозиторий и лежит в его корне.
  envDir: '../..',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rolldownOptions: {
      output: {
        /*
         * three.js отделён от кода игры (§2 ТЗ, M9.4). Общий вес от этого не меняется,
         * но правка игры перестаёт сбрасывать кеш на три четверти мегабайта библиотеки:
         * возвращаясь на остров назавтра, игрок докачивает килобайты, а не всё заново.
         */
        advancedChunks: {
          groups: [{ name: 'three', test: /node_modules[/\\]three[/\\]/ }],
        },
      },
    },
  },
  worker: {
    // Мешинг чанков и A* уедут в воркеры начиная с M1.3 — формат фиксируем сразу.
    format: 'es',
  },
});
