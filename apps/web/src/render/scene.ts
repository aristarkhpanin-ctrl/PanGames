import { generateIsland, VOXEL_SIZE, WORLD_X, WORLD_Z } from '@gavan/shared';
import * as THREE from 'three';

import { CameraControls } from '../input/controls';
import { DebugOverlay } from './debugOverlay';
import { Decor } from './decor';
import { Lighting } from './lighting';
import { MesherPool } from './mesherPool';
import { Terrain } from './terrain';
import { Water } from './water';

/**
 * Сборка сцены: остров из сида, чанки из воркеров, вода, деревья, свет и камера.
 *
 * Всё тяжёлое живёт вне главного потока: генерация занимает около 70 мс один раз при входе,
 * мешинг целиком уезжает в воркеры (§2.4, §12 ТЗ).
 */

/** Реальных секунд в игровом часе (§3 ТЗ). Игровые сутки — 24 минуты. */
const SECONDS_PER_GAME_HOUR = 60;

export interface SceneHandle {
  dispose(): void;
}

export async function createScene(canvas: HTMLCanvasElement, seed: number): Promise<SceneHandle> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap в three объявлен устаревшим и всё равно откатывается к PCF.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 400);

  const island = generateIsland(seed);

  const pool = new MesherPool(island.voxels);
  const terrain = new Terrain(pool);
  const water = new Water(island.shape.waterDepth);
  const decor = new Decor(island.trees);
  const lighting = new Lighting(scene);
  const controls = new CameraControls(camera, canvas);
  const debug = new DebugOverlay(renderer);

  scene.add(terrain.group, water.group, decor.group);

  const resize = (): void => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    // Ограничиваем плотность пикселей: бюджет считается по интегрированной графике.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  let hour = 9;
  debug.hour = hour;

  // THREE.Clock объявлен устаревшим; своё время надёжнее и не тянет лишний класс.
  let previous = performance.now();
  let frameId = 0;

  const loop = (): void => {
    frameId = requestAnimationFrame(loop);

    // Крупный шаг после сворачивания вкладки не должен дёргать камеру и время.
    const now = performance.now();
    const delta = Math.min((now - previous) / 1000, 0.1);
    previous = now;

    if (debug.timeRunning) {
      hour = (hour + delta / SECONDS_PER_GAME_HOUR) % 24;
      debug.hour = hour;
    } else {
      hour = debug.hour;
    }

    controls.update(delta);
    const sky = lighting.update(hour, controls.focus);
    water.update(delta, sky);

    renderer.render(scene, camera);
    debug.update(delta);
  };

  loop();

  // Меши приезжают по мере готовности: остров проявляется чанк за чанком, а не после паузы.
  await terrain.buildAll();

  return {
    dispose(): void {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      controls.dispose();
      debug.dispose();
      terrain.dispose();
      water.dispose();
      decor.dispose();
      pool.dispose();
      renderer.dispose();
    },
  };
}

/** Центр мира в метрах — пригодится и камере, и облёту в режиме «Смотреть». */
export const WORLD_CENTER = new THREE.Vector3(
  (WORLD_X * VOXEL_SIZE) / 2,
  0,
  (WORLD_Z * VOXEL_SIZE) / 2,
);
