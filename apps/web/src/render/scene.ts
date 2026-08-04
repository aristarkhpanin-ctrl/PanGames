import {
  generateIsland,
  hourOfTick,
  TICKS_PER_HOUR,
  VOXEL_SIZE,
  WORLD_X,
  WORLD_Z,
} from '@gavan/shared';
import * as THREE from 'three';

import { CameraControls } from '../input/controls';
import { Editing, REJECT_TEXT } from '../input/editing';
import { Picker } from '../input/picking';
import { CommandBus, LocalTransport } from '../net/commands';
import { LiveWorld, type WorldUpdate } from '../state/liveWorld';
import { loadWorld, saveWorld } from '../state/localSave';
import { EconomyDriver, publishEconomy } from '../sim/economyDriver';
import { SimClient } from '../sim/simClient';
import { useGameStore } from '../state/store';
import { BuildingRenderer } from './buildingRenderer';
import { DebugOverlay } from './debugOverlay';
import { Decor } from './decor';
import { Ghost } from './ghost';
import { Highlight } from './highlight';
import { Lighting } from './lighting';
import { MesherPool } from './mesherPool';
import { Plants } from './plants';
import { VillagerRenderer } from './villagerRenderer';
import { Terrain } from './terrain';
import { Water } from './water';

/**
 * Сборка сцены: остров из сида, чанки из воркеров, вода, деревья, свет, камера и редактирование.
 *
 * Всё тяжёлое живёт вне главного потока: генерация занимает около 70 мс один раз при входе,
 * мешинг целиком уезжает в воркеры (§2.4, §12 ТЗ).
 */

/** Реальных секунд в игровом часе (§3 ТЗ). Игровые сутки — 24 минуты. */
const SECONDS_PER_GAME_HOUR = 60;

/** Как долго ждать затишья, прежде чем записать мир. Протяжка кистью шлёт правки пачками. */
const SAVE_DELAY_MS = 700;

/** С какого часа начинается первый день на новом острове: девять утра (§3 ТЗ). */
const START_TICK = 9 * TICKS_PER_HOUR;

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
  const world = new LiveWorld(island);

  // Сохранённый мир поднимается до всего остального: и мешер, и симуляция получают уже
  // готовый остров, и строить его дважды не приходится.
  const saved = loadWorld(seed);
  if (saved !== null) world.restore(saved);
  const startTick = saved?.tick ?? START_TICK;

  const pool = new MesherPool(world.voxels);
  const terrain = new Terrain(pool);
  const water = new Water(island.shape.waterDepth);
  const decor = new Decor(island.trees);
  const plants = new Plants();
  const buildingRenderer = new BuildingRenderer();
  const villagerRenderer = new VillagerRenderer();
  const highlight = new Highlight();
  const ghost = new Ghost();
  const lighting = new Lighting(scene);
  const controls = new CameraControls(camera, canvas);
  const debug = new DebugOverlay(renderer);

  scene.add(
    terrain.group,
    water.group,
    decor.group,
    plants.group,
    buildingRenderer.group,
    villagerRenderer.group,
    highlight.object,
    ghost.group,
  );

  // Симуляция целиком в воркере: поиск пути не имеет права задержать кадр (§12 ТЗ).
  const sim = new SimClient(world.voxels, seed, 'island-local', startTick);
  sim.subscribe((villagers) => {
    useGameStore.getState().setVillagers(villagers);
  });

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleSave = (): void => {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveWorld(world, sim.tick);
    }, SAVE_DELAY_MS);
  };

  /**
   * Правка мира: копии в воркерах догоняют главный поток, и перестраиваются только
   * задетые чанки — вместе с соседними, если правка легла у самой границы.
   */
  const onWorldChanged = (update: WorldUpdate): void => {
    if (update.changes.length > 0) {
      const indices = new Uint32Array(update.changes.length);
      const materials = new Uint8Array(update.changes.length);
      update.changes.forEach((change, i) => {
        indices[i] = change.index;
        materials[i] = change.material;
      });
      pool.applyEdits(indices, materials);
      sim.applyEdits(indices, materials);
    }

    if (update.dirty.size > 0) void terrain.rebuild(update.dirty);
    plants.rebuild(world.plants);
    scheduleSave();
  };

  const bus = new CommandBus(world, new LocalTransport(), onWorldChanged);
  const picker = new Picker(camera, world);

  /** Здания изменились: перерисовать их и рассказать об этом воркеру симуляции. */
  const onBuildingsChanged = (): void => {
    buildingRenderer.rebuild(world.state.buildings);
    sim.setWorld(world.state.buildings, world.plants);
    publishEconomy(world);
    scheduleSave();
  };

  const economy = new EconomyDriver(world, bus, island.resourceNodes, onBuildingsChanged);

  /**
   * Как интерфейс отправляет команды. React ничего не знает про шину и не имеет права
   * трогать мир сам — он только просит, а решение принимается там же, где и всегда.
   */
  useGameStore.getState().setSender((command) => {
    void bus.run(command).then((outcome) => {
      if (outcome.result.ok) {
        onBuildingsChanged();
        return;
      }
      const text = REJECT_TEXT[outcome.result.reason];
      if (text !== undefined) useGameStore.getState().setNotice(text);
    });
  });

  const editing = new Editing(
    canvas,
    picker,
    highlight,
    ghost,
    bus,
    world,
    () => {
      plants.rebuild(world.plants);
      sim.setWorld(world.state.buildings, world.plants);
      scheduleSave();
    },
    onBuildingsChanged,
  );

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

  // Часы у жителей и у солнца одни: житель решает по `hourOfTick`, а свет и производство —
  // по этому числу, и расходиться им нельзя.
  let hour = hourOfTick(startTick);
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
    editing.updateHighlight();

    const alpha = sim.update(delta, (tick) => {
      useGameStore.getState().setTick(tick);
      economy.step(tick, hour, sim.villagers);
    });
    villagerRenderer.update(sim.villagers, sim.previousVillagers, alpha, delta);
    const sky = lighting.update(hour, controls.focus);
    water.update(delta, sky);

    renderer.render(scene, camera);
    debug.update(delta);
  };

  loop();

  plants.rebuild(world.plants);
  buildingRenderer.rebuild(world.state.buildings);
  sim.setWorld(world.state.buildings, world.plants);
  publishEconomy(world);
  useGameStore.getState().setTick(startTick);

  // Меши приезжают по мере готовности: остров проявляется чанк за чанком, а не после паузы.
  await terrain.buildAll();
  useGameStore.getState().setWorldReady(true);

  return {
    dispose(): void {
      cancelAnimationFrame(frameId);
      if (saveTimer !== null) clearTimeout(saveTimer);
      observer.disconnect();
      useGameStore.getState().setSender(null);
      editing.dispose();
      controls.dispose();
      debug.dispose();
      highlight.dispose();
      ghost.dispose();
      buildingRenderer.dispose();
      sim.dispose();
      villagerRenderer.dispose();
      plants.dispose();
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
