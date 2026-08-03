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
  },
  worker: {
    // Мешинг чанков и A* уедут в воркеры начиная с M1.3 — формат фиксируем сразу.
    format: 'es',
  },
});
