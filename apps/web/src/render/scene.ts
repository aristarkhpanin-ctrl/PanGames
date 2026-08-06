import {
  buildNavGrid,
  findLandingSite,
  fromSnapshot,
  generateIsland,
  VOXEL_SIZE,
  WORLD_X,
  WORLD_Z,
  type ResourceId,
} from '@gavan/shared';
import * as THREE from 'three';

import { Ambient } from '../audio/ambient';
import { CameraControls } from '../input/controls';
import { Editing, REJECT_TEXT } from '../input/editing';
import { Picker } from '../input/picking';
import type { IslandState } from '../net/api';
import { sendCommands } from '../net/api';
import { CommandBus, NetworkTransport } from '../net/commands';
import { LiveLink, type LiveMessage } from '../net/live';
import { LiveWorld, type WorldUpdate } from '../state/liveWorld';
import { useGameStore } from '../state/store';
import { VillagerStream } from '../sim/villagerStream';
import { Arrival, FirstSpot } from './arrival';
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
import { WatchMode } from './watch';
import { Water } from './water';

/**
 * Сборка сцены: остров с сервера, чанки из воркеров, вода, деревья, свет, камера и правки.
 *
 * Считает мир сервер (M5): он единственный двигает время, производство и жителей. Клиент
 * рисует, предсказывает команды и сглаживает движение между тиками. Всё тяжёлое живёт вне
 * главного потока: мешинг целиком уезжает в воркеры (§2.4, §12 ТЗ).
 */

/** Реальных секунд в игровом часе (§3 ТЗ). Игровые сутки — 24 минуты. */
const SECONDS_PER_GAME_HOUR = 60;

/** Угол обзора и соотношение сторон, под которые подобрана картинка: обычное окно ноутбука. */
const BASE_FOV = 50;
const BASE_ASPECT = 16 / 10;

export interface SceneHandle {
  dispose(): void;
}

export async function createScene(
  canvas: HTMLCanvasElement,
  initial: IslandState,
): Promise<SceneHandle> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap в three объявлен устаревшим и всё равно откатывается к PCF.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 400);

  const island = generateIsland(initial.seed);
  const world = new LiveWorld(island);

  // Состояние приезжает с сервера до всего остального: и мешер, и пикинг получают уже
  // готовый остров, и строить его дважды не приходится.
  world.adopt(fromSnapshot(initial.world));

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
  // Камера получает касания первой: только она знает, сколько пальцев на экране. То, что
  // ей не принадлежит — короткое нажатие и протяжка призрака, — она отдаёт правкам мира.
  const controls = new CameraControls(camera, canvas, {
    tap: (x, y) => {
      editing.touchTap(x, y);
    },
    drag: (x, y) => editing.touchDrag(x, y),
  });
  const debug = new DebugOverlay(renderer);
  const watch = new WatchMode();
  const ambient = new Ambient();

  // Звук включается по первому действию игрока: браузер не даст раньше, да и не надо —
  // игра не должна начинаться с неожиданного шума.
  const startAudio = (): void => {
    ambient.start();
    window.removeEventListener('pointerdown', startAudio);
    window.removeEventListener('keydown', startAudio);
  };
  window.addEventListener('pointerdown', startAudio);
  window.addEventListener('keydown', startAudio);

  // Кнопка выключения живёт в React, микшер — в Web Audio; связывает их одна подписка.
  ambient.setMuted(useGameStore.getState().muted);
  const unwatchMute = useGameStore.subscribe((state, previous) => {
    if (state.muted !== previous.muted) ambient.setMuted(state.muted);
  });

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

  /**
   * Прибытие (§11 ТЗ) — только на пустом острове и только один раз.
   *
   * Признак «пустой» берётся из мира, а не из флага: остров, на котором уже что-то стоит,
   * человек точно видел. Отметка о просмотре живёт рядом с браузером — переигрывать
   * первую минуту тому, кто её уже прошёл, было бы неуважением к его времени.
   */
  const firstTime = !useGameStore.getState().guest && world.state.buildings.length === 0;
  const site = firstTime ? findLandingSite(buildNavGrid(world), island.shape) : null;
  const arrival = site !== null && !alreadyArrived(initial.id) ? new Arrival(site) : null;
  const firstSpot = site !== null ? new FirstSpot(site.hut) : null;

  if (firstSpot !== null) scene.add(firstSpot.group);
  if (arrival !== null) {
    scene.add(arrival.group);
    rememberArrival(initial.id);
    useGameStore.getState().setArrival('playing');
    // Метка ждёт, пока лодка причалит: подсказка до прибытия — это подсказка в пустоту.
    if (firstSpot !== null) firstSpot.visible = false;
  }

  const stream = new VillagerStream();
  stream.accept(initial.villagers);

  /**
   * Правка мира: копия в воркерах догоняет главный поток, и перестраиваются только
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
    }

    if (update.dirty.size > 0) void terrain.rebuild(update.dirty);
    plants.rebuild(world.plants);
  };

  const bus = new CommandBus(world, new NetworkTransport(initial.id, sendCommands), onWorldChanged);
  const picker = new Picker(camera, world);

  const publish = (): void => {
    useGameStore
      .getState()
      .setEconomy({ ...world.state.resources }, world.state.storageCap, [...world.state.buildings]);
  };

  const onBuildingsChanged = (): void => {
    buildingRenderer.rebuild(world.state.buildings);
    // Облёт идёт по тому, что игрок построил, — маршрут пересобирается вместе с островом.
    watch.planRoute(world.state.buildings, WORLD_CENTER);
    // Первая постройка гасит метку. Дальше объясняют желания жителей, а не интерфейс.
    if (firstSpot !== null && world.state.buildings.length > 0) firstSpot.visible = false;
    publish();
  };

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
      onBuildingsChanged();
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
    },
    onBuildingsChanged,
  );

  useGameStore.getState().setConfirmBuild(() => {
    editing.confirmPlacement();
  });

  let hour = initial.hour;

  /**
   * Тик с сервера: он решает, что стало с миром. Клиентское предсказание при расхождении
   * поправляется дельтой — сцена не пересобирается, картинка не мигает.
   */
  const onMessage = (message: LiveMessage): void => {
    if (message.type === 'hello') {
      // Переподключились: полное состояние приезжает разом и всё расставляет по местам.
      world.adopt(fromSnapshot(message.world));
      stream.accept(message.villagers);
      hour = message.hour;
      debug.hour = hour;
      onBuildingsChanged();
      plants.rebuild(world.plants);
      useGameStore.getState().setTick(message.tick);
      return;
    }

    stream.accept(message.villagers);
    useGameStore.getState().setVillagers(message.villagers);
    useGameStore.getState().setTick(message.tick);
    useGameStore.getState().addJournal(message.journal ?? []);
    if (message.chapter !== undefined) useGameStore.getState().showChapter(message.chapter.name);

    world.state.buildings = message.buildings;
    for (const [id, amount] of Object.entries(message.resources) as [ResourceId, number][]) {
      world.state.resources[id] = amount;
    }
    world.state.storageCap = message.storageCap;

    if (debug.timeRunning) {
      hour = message.hour;
      debug.hour = hour;
    }

    onBuildingsChanged();
  };

  /** Конец прибытия: камера отдаётся игроку и встаёт там, где он её оставил бы сам. */
  const endArrival = (): void => {
    if (arrival === null) return;
    arrival.skip();
    scene.remove(arrival.group);
    controls.moveTo(arrival.restingTarget(), 26, arrival.restingYaw());
    if (firstSpot !== null && world.state.buildings.length === 0) firstSpot.visible = true;
    useGameStore.getState().setArrival('shown');
  };

  // Пропуск — любой клавишей и любым щелчком (§11 ТЗ). Кнопки «пропустить» нет: она сама
  // по себе сообщала бы, что дальше будет что-то, что хочется пропустить.
  const onSkip = (): void => {
    if (useGameStore.getState().arrival !== 'playing') return;
    endArrival();
  };

  if (arrival !== null) {
    window.addEventListener('keydown', onSkip);
    window.addEventListener('pointerdown', onSkip);
  }

  // Клавиша V — вход и выход. Выход по любой клавише: держать игрока в режиме нельзя.
  const onWatchKey = (event: KeyboardEvent): void => {
    const store = useGameStore.getState();

    if (store.arrival === 'playing') return;

    if (store.watching) {
      event.preventDefault();
      store.setWatching(false);
      watch.reset();
      return;
    }

    if (event.code !== 'KeyV' || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    watch.reset();
    watch.planRoute(world.state.buildings, WORLD_CENTER);
    store.setWatching(true);
  };
  window.addEventListener('keydown', onWatchKey);

  const link = new LiveLink(initial.id, {
    onMessage,
    onStatus: (status) => {
      useGameStore
        .getState()
        .setServerStatus(
          status === 'online' ? 'online' : status === 'offline' ? 'unreachable' : 'unknown',
        );
    },
  });
  link.connect();

  const resize = (): void => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    // Ограничиваем плотность пикселей: бюджет считается по интегрированной графике.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;

    /*
     * На телефоне экран узкий и высокий. Если оставить угол обзора по вертикали, поперёк
     * острова окажется втрое меньше, чем на ноутбуке, и камера утыкается в первое же дерево.
     * Поэтому по вертикали угол расширяется так, чтобы поперечный обзор оставался прежним.
     */
    const wide = Math.max(camera.aspect, BASE_ASPECT);
    camera.fov =
      THREE.MathUtils.radToDeg(
        Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV) / 2) * (wide / camera.aspect)),
      ) * 2;

    camera.updateProjectionMatrix();
  };

  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  debug.hour = hour;

  // THREE.Clock объявлен устаревшим; своё время надёжнее и не тянет лишний класс.
  let previous = performance.now();
  let frameId = 0;
  /** Строка «Здесь будет хорошо» ставится один раз, а не каждый кадр. */
  let moored = false;

  const loop = (): void => {
    frameId = requestAnimationFrame(loop);

    // Крупный шаг после сворачивания вкладки не должен дёргать камеру и время.
    const now = performance.now();
    const delta = Math.min((now - previous) / 1000, 0.1);
    previous = now;

    // Между тиками солнце идёт само: сервер задаёт час, клиент доводит его до следующего.
    if (debug.timeRunning) {
      hour = (hour + delta / SECONDS_PER_GAME_HOUR) % 24;
      debug.hour = hour;
    } else {
      hour = debug.hour;
    }

    // Прибытие идёт первым: пока лодка не причалила, ни камера, ни правки игроку не отданы.
    if (arrival !== null && useGameStore.getState().arrival === 'playing') {
      const sailing = arrival.update(camera, delta);
      if (arrival.moored && !moored) {
        moored = true;
        useGameStore.getState().setMoored(true);
      }
      highlight.hide();
      ghost.hide();
      if (!sailing) endArrival();
    } else if (useGameStore.getState().watching) {
      // Режим «Смотреть»: камера ведёт себя сама, интерфейс уходит целиком (§8 ТЗ).
      watch.update(camera, controls.focus, delta);
      highlight.hide();
      ghost.hide();
    } else {
      controls.update(delta);
      editing.updateHighlight();
    }

    const alpha = stream.update(delta);
    villagerRenderer.update(stream.villagers, stream.previousVillagers, alpha, delta);
    const sky = lighting.update(hour, controls.focus);
    water.update(delta, sky);
    ambient.update(hour, distanceToWater(controls.focus, island.shape));

    renderer.render(scene, camera);
    debug.update(delta);
  };

  loop();

  plants.rebuild(world.plants);
  buildingRenderer.rebuild(world.state.buildings);
  watch.planRoute(world.state.buildings, WORLD_CENTER);
  publish();
  useGameStore.getState().setVillagers(initial.villagers);
  useGameStore.getState().setTick(initial.tick);

  // Меши приезжают по мере готовности: остров проявляется чанк за чанком, а не после паузы.
  await terrain.buildAll();
  useGameStore.getState().setWorldReady(true);

  return {
    dispose(): void {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener('keydown', onWatchKey);
      window.removeEventListener('keydown', onSkip);
      window.removeEventListener('pointerdown', onSkip);
      arrival?.dispose();
      firstSpot?.dispose();
      window.removeEventListener('pointerdown', startAudio);
      window.removeEventListener('keydown', startAudio);
      unwatchMute();
      ambient.dispose();
      useGameStore.getState().setSender(null);
      useGameStore.getState().setConfirmBuild(null);
      link.dispose();
      editing.dispose();
      controls.dispose();
      debug.dispose();
      highlight.dispose();
      ghost.dispose();
      buildingRenderer.dispose();
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

/**
 * Отметка о том, что прибытие уже показывали. Живёт в браузере, а не на сервере: это факт
 * про человека за экраном, а не про остров, и хранить его вместе с игровым состоянием незачем.
 */
const ARRIVAL_KEY = 'gavan.arrival';

function alreadyArrived(islandId: string): boolean {
  try {
    return window.localStorage.getItem(`${ARRIVAL_KEY}.${islandId}`) !== null;
  } catch {
    // Приватный режим запрещает хранилище. Прибытие покажется ещё раз — это не поломка.
    return false;
  }
}

function rememberArrival(islandId: string): void {
  try {
    window.localStorage.setItem(`${ARRIVAL_KEY}.${islandId}`, '1');
  } catch {
    // См. выше: без хранилища игра работает, просто первая минута может повториться.
  }
}

/** Сколько клеток от точки до воды. По этому числу микшируется шум прибоя. */
function distanceToWater(point: THREE.Vector3, shape: { distToWater: Int16Array }): number {
  const x = Math.round(point.x / VOXEL_SIZE);
  const z = Math.round(point.z / VOXEL_SIZE);
  if (x < 0 || x >= WORLD_X || z < 0 || z >= WORLD_Z) return 0;
  return shape.distToWater[x + WORLD_X * z] ?? 0;
}

/** Центр мира в метрах — пригодится и камере, и облёту в режиме «Смотреть». */
export const WORLD_CENTER = new THREE.Vector3(
  (WORLD_X * VOXEL_SIZE) / 2,
  0,
  (WORLD_Z * VOXEL_SIZE) / 2,
);
