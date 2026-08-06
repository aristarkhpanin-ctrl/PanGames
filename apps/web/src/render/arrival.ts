import {
  materialColor,
  Material,
  Palette,
  SEA_LEVEL,
  VOXEL_SIZE,
  type LandingSite,
  type Vec3,
} from '@gavan/shared';
import * as THREE from 'three';

/**
 * Первая минута игры (§11 ТЗ).
 *
 * Море и лодка. Лодка причаливает, четверо сходят на берег, камера опускается. Одна строка
 * текста — и всё, дальше игрок свободен.
 *
 * Здесь нет и не будет: туториала, модальных окон, стрелок, «нажмите здесь», шагов с номерами.
 * Место под первый шалаш просто подсвечено — этого достаточно, чтобы понять, что делать,
 * и достаточно мало, чтобы не мешать тому, кто хочет делать по-своему.
 *
 * Сцена пропускается любой клавишей и любым щелчком: удерживать человека в ролике нельзя.
 */

/** Сколько секунд идёт прибытие целиком. Дольше — уже ролик, а не первая минута. */
const DURATION = 14;

/** Когда лодка встаёт у берега: к этому моменту камера уже опустилась. */
const MOORED_AT = 9;

/**
 * Откуда и куда идёт камера: издалека виден весь остров, вблизи — четверо на песке.
 *
 * Спуск заканчивается вместе со швартовкой, а не вместе со сценой: к моменту, когда лодка
 * коснулась берега, смотреть надо уже на людей. Последние секунды камера просто стоит.
 */
const FAR = { distance: 80, height: 46 };
const NEAR = { distance: 17, height: 8 };

/** Насколько взгляд поднят над водой, чтобы в кадр попадал берег, а не только прибой. */
const LOOK_ABOVE = 2.5;

export class Arrival {
  readonly group = new THREE.Group();

  private time = 0;
  private done = false;

  private readonly boat: THREE.Group;
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  /**
   * `prefers-reduced-motion` не отменяет прибытие, а укорачивает его: лодка уже у берега,
   * камера уже внизу. Показать остров нужно всё равно — просто без полёта (§8 ТЗ).
   */
  private readonly reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private readonly site: LandingSite) {
    this.from.set(site.offing.x * VOXEL_SIZE, waterLine(), site.offing.z * VOXEL_SIZE);
    this.to.set(site.moor.x * VOXEL_SIZE, waterLine(), site.moor.z * VOXEL_SIZE);

    this.boat = this.buildBoat();
    this.group.add(this.boat);

    if (this.reducedMotion) this.time = MOORED_AT;
  }

  /** Пришвартовалась ли лодка: по этому моменту появляется единственная строка текста. */
  get moored(): boolean {
    return this.time >= MOORED_AT;
  }

  /** Двигает лодку и камеру. Возвращает `false`, когда сцена закончилась. */
  update(camera: THREE.PerspectiveCamera, delta: number): boolean {
    if (this.done) return false;

    this.time = Math.min(this.time + delta, DURATION);

    const sail = ease(Math.min(this.time / MOORED_AT, 1));
    this.boat.position.lerpVectors(this.from, this.to, sail);
    this.boat.lookAt(this.to.x, this.boat.position.y, this.to.z);
    // Лодку качает — очень слабо, чтобы это читалось как вода, а не как тряска.
    this.boat.position.y = waterLine() + Math.sin(this.time * 1.4) * 0.12;
    this.boat.rotation.z = Math.sin(this.time * 1.1) * 0.04;

    // Камера опускается: с высоты птичьего полёта над морем к берегу, где стоят четверо.
    const descent = ease(Math.min(this.time / MOORED_AT, 1));
    const distance = THREE.MathUtils.lerp(FAR.distance, NEAR.distance, descent);
    const height = THREE.MathUtils.lerp(FAR.height, NEAR.height, descent);

    // Взгляд переезжает с лодки на берег: к концу сцены в кадре люди, а не транспорт.
    this.look.lerpVectors(this.boat.position, this.landfall(), descent);
    this.look.y = waterLine() + LOOK_ABOVE;

    // Камера стоит со стороны моря и смотрит на остров — так первый кадр показывает берег.
    const back = new THREE.Vector3()
      .subVectors(this.from, this.to)
      .setY(0)
      .normalize()
      .multiplyScalar(distance);

    this.eye.set(this.look.x + back.x, this.look.y + height, this.look.z + back.z);
    camera.position.copy(this.eye);
    camera.lookAt(this.look);

    if (this.time >= DURATION) this.done = true;
    return !this.done;
  }

  /** Пропуск: любая клавиша, любой щелчок. Сцена заканчивается сразу и не повторяется. */
  skip(): void {
    this.done = true;
    this.time = DURATION;
  }

  /** Куда поставить обычную камеру после сцены: берег с местом под шалаш в кадре. */
  restingTarget(): THREE.Vector3 {
    return this.landfall();
  }

  /** С какой стороны смотреть после сцены — с той же, с какой смотрела камера прибытия. */
  restingYaw(): number {
    return Math.atan2(this.from.z - this.to.z, this.from.x - this.to.x);
  }

  /**
   * Точка между берегом и местом под шалаш. Смотреть строго на берег значило бы оставить
   * подсказку за краем кадра, а строго на подсказку — потерять из виду людей.
   */
  private landfall(): THREE.Vector3 {
    return new THREE.Vector3(
      ((this.site.shore.x + this.site.hut.x) / 2) * VOXEL_SIZE,
      this.site.shore.y * VOXEL_SIZE,
      ((this.site.shore.z + this.site.hut.z) / 2) * VOXEL_SIZE,
    );
  }

  /**
   * Лодка — из тех же кубиков и тех же цветов, что весь остров: отдельного «киношного»
   * материала в игре нет и заводить его незачем.
   */
  private buildBoat(): THREE.Group {
    const group = new THREE.Group();

    const hull = new THREE.BoxGeometry(VOXEL_SIZE * 7, VOXEL_SIZE * 1.6, VOXEL_SIZE * 2.6);
    const deck = new THREE.BoxGeometry(VOXEL_SIZE * 4.4, VOXEL_SIZE * 0.4, VOXEL_SIZE * 2);
    const mast = new THREE.CylinderGeometry(VOXEL_SIZE * 0.16, VOXEL_SIZE * 0.16, VOXEL_SIZE * 5.5);
    const sail = new THREE.PlaneGeometry(VOXEL_SIZE * 3.4, VOXEL_SIZE * 4);

    const woodMaterial = new THREE.MeshLambertMaterial({ color: materialColor(Material.WOOD) });
    const plankMaterial = new THREE.MeshLambertMaterial({ color: materialColor(Material.PLANK) });
    const sailMaterial = new THREE.MeshLambertMaterial({
      color: materialColor(Material.FLOWER_WHITE),
      side: THREE.DoubleSide,
    });

    const hullMesh = new THREE.Mesh(hull, woodMaterial);
    hullMesh.castShadow = true;

    const deckMesh = new THREE.Mesh(deck, plankMaterial);
    deckMesh.position.y = VOXEL_SIZE;

    const mastMesh = new THREE.Mesh(mast, woodMaterial);
    mastMesh.position.y = VOXEL_SIZE * 3.5;

    const sailMesh = new THREE.Mesh(sail, sailMaterial);
    sailMesh.position.set(0, VOXEL_SIZE * 4, 0);
    sailMesh.rotation.y = Math.PI / 2;
    sailMesh.castShadow = true;

    group.add(hullMesh, deckMesh, mastMesh, sailMesh);
    this.disposables.push(hull, deck, mast, sail, woodMaterial, plankMaterial, sailMaterial);
    return group;
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.group.clear();
  }
}

/**
 * Место под первый шалаш.
 *
 * Это вся подсказка, которая есть в игре: не стрелка, не всплывающее окно и не шаг туториала,
 * а тёплое пятно на песке. Оно ничего не требует и никуда не ведёт — на него можно не обращать
 * внимания и строить где угодно. Гаснет само, как только на острове появилась первая постройка:
 * дальше объясняют желания жителей, а не интерфейс.
 *
 * Свечение ровное. Мигания и пульсации в «Гавани» нет нигде — ни в курсоре, ни здесь.
 */
export class FirstSpot {
  readonly group = new THREE.Group();
  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  constructor(hut: Vec3, side = 2) {
    const size = side * VOXEL_SIZE;
    const y = hut.y * VOXEL_SIZE + 0.03;

    const center = { x: hut.x * VOXEL_SIZE + size / 2, z: hut.z * VOXEL_SIZE + size / 2 };

    const patch = new THREE.PlaneGeometry(size, size);
    const patchMaterial = new THREE.MeshBasicMaterial({
      color: Palette.lamp,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });

    const glow = new THREE.Mesh(patch, patchMaterial);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(center.x, y, center.z);
    glow.renderOrder = 2;

    // Пятно размером в сам след здания слишком мелкое, чтобы его заметить с обычной высоты
    // камеры. Вокруг лежит мягкий ореол — он не показывает границ, а просто притягивает взгляд.
    const halo = new THREE.CircleGeometry(size * 1.9, 24);
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: Palette.lamp,
      transparent: true,
      opacity: 0.13,
      depthWrite: false,
    });

    const haloMesh = new THREE.Mesh(halo, haloMaterial);
    haloMesh.rotation.x = -Math.PI / 2;
    haloMesh.position.set(center.x, y - 0.01, center.z);
    haloMesh.renderOrder = 1;

    const outline = new THREE.BufferGeometry();
    const x0 = hut.x * VOXEL_SIZE;
    const z0 = hut.z * VOXEL_SIZE;
    const x1 = x0 + size;
    const z1 = z0 + size;
    outline.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0],
        3,
      ),
    );

    const outlineMaterial = new THREE.LineBasicMaterial({
      color: Palette.lamp,
      transparent: true,
      opacity: 0.9,
    });

    this.group.add(haloMesh, glow, new THREE.LineSegments(outline, outlineMaterial));
    this.disposables.push(patch, patchMaterial, halo, haloMaterial, outline, outlineMaterial);
  }

  set visible(visible: boolean) {
    this.group.visible = visible;
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.group.clear();
  }
}

/** Уровень воды в метрах: по нему плавает лодка. */
function waterLine(): number {
  return (SEA_LEVEL + 1) * VOXEL_SIZE;
}

/** Мягкий разгон и мягкое торможение. Ничего в этой игре не начинается рывком. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}
