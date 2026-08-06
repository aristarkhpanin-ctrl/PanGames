import { SEA_LEVEL, VOXEL_SIZE, WORLD_X, WORLD_Z } from '@gavan/shared';
import * as THREE from 'three';

/**
 * Орбитальная камера в духе RTS (§2.5 ТЗ).
 *
 * ЛКМ — выбор (появится на M2.2), ПКМ или пробел с перетаскиванием — панорама,
 * колесо — зум, Q и E — поворот на 45°, Alt с перетаскиванием — свободный поворот.
 * При отпускании поворот примагничивается к ближайшим 45°: остров всегда стоит ровно,
 * но крутить его можно плавно.
 *
 * Никакой резкости: всё едет к целевым значениям сглаживанием. Игра про спокойствие,
 * и камера — первое, что об этом сообщает.
 */

const MIN_DISTANCE = 15;
const MAX_DISTANCE = 90;
const MIN_PITCH = THREE.MathUtils.degToRad(25);
const MAX_PITCH = THREE.MathUtils.degToRad(70);
const SNAP = Math.PI / 4;

/** Насколько палец может сдвинуться, чтобы это всё ещё считалось нажатием, а не панорамой. */
const TAP_SLOP = 10;

/** Дольше — это уже не нажатие, а задумчивое удержание, и мир от него не меняется. */
const TAP_MS = 400;

/** Окно двойного касания. */
const DOUBLE_TAP_MS = 320;

/** Плоскость, по которой ездит точка взгляда: уровень воды. */
const GROUND_Y = (SEA_LEVEL + 1) * VOXEL_SIZE;

const WORLD_WIDTH = WORLD_X * VOXEL_SIZE;
const WORLD_DEPTH = WORLD_Z * VOXEL_SIZE;
/** Насколько взгляд может уйти за пределы острова. */
const MARGIN = 12;

export class CameraControls {
  private readonly target = new THREE.Vector3(WORLD_WIDTH / 2, GROUND_Y, WORLD_DEPTH / 2);
  private readonly desiredTarget = this.target.clone();

  private distance = 70;
  private desiredDistance = 70;
  private yaw = Math.PI / 4;
  private desiredYaw = Math.PI / 4;
  private pitch = THREE.MathUtils.degToRad(48);
  private desiredPitch = THREE.MathUtils.degToRad(48);

  private panning = false;
  private rotating = false;
  private spaceHeld = false;
  private lastPointer: { x: number; y: number } | null = null;
  private readonly detach: (() => void)[] = [];

  /** Пальцы на экране. Один — панорама, два — зум и поворот. */
  private readonly touches = new Map<number, { x: number; y: number }>();
  private tapStart: { x: number; y: number; at: number } | null = null;
  private pinch: { spread: number; angle: number } | null = null;
  private lastTapAt = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly element: HTMLElement,
    /**
     * Что делать с касаниями, которые камере не принадлежат.
     *
     * `tap` — короткое касание без движения: камера его не забирает, а отдаёт правкам мира.
     * `drag` — протяжка одним пальцем: если мир её забрал (двигает призрак здания), камера
     * не панорамирует. Иначе поставить дом на телефоне было бы нечем.
     */
    private readonly touchHost?: {
      tap: (x: number, y: number) => void;
      drag: (x: number, y: number) => boolean;
    },
  ) {
    this.bind();
    this.apply();
  }

  /** Точка, на которую смотрит камера: за ней следуют карта теней и облёт. */
  get focus(): THREE.Vector3 {
    return this.target;
  }

  private bind(): void {
    const onPointerDown = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') {
        this.touchDown(event);
        return;
      }

      if (event.button === 2 || (event.button === 0 && this.spaceHeld)) {
        this.panning = true;
      } else if (event.button === 1 || (event.button === 0 && event.altKey)) {
        this.rotating = true;
      } else {
        return;
      }
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.element.setPointerCapture(event.pointerId);
      event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') {
        this.touchMove(event);
        return;
      }

      if (this.lastPointer === null) return;
      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      this.lastPointer = { x: event.clientX, y: event.clientY };

      if (this.panning) this.pan(dx, dy);
      else if (this.rotating) this.rotate(dx, dy);
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') {
        this.touchUp(event);
        return;
      }

      if (this.rotating) this.snapYaw();
      this.panning = false;
      this.rotating = false;
      this.lastPointer = null;
      if (this.element.hasPointerCapture(event.pointerId)) {
        this.element.releasePointerCapture(event.pointerId);
      }
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const factor = Math.exp(event.deltaY * 0.0012);
      this.desiredDistance = THREE.MathUtils.clamp(
        this.desiredDistance * factor,
        MIN_DISTANCE,
        MAX_DISTANCE,
      );
    };

    const onContextMenu = (event: Event): void => {
      event.preventDefault();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === 'Space') {
        this.spaceHeld = true;
        event.preventDefault();
      }
      if (event.code === 'KeyQ') this.desiredYaw -= SNAP;
      if (event.code === 'KeyE') this.desiredYaw += SNAP;
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === 'Space') this.spaceHeld = false;
    };

    this.element.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    this.element.addEventListener('wheel', onWheel, { passive: false });
    this.element.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    this.detach.push(
      () => {
        this.element.removeEventListener('pointerdown', onPointerDown);
      },
      () => {
        window.removeEventListener('pointermove', onPointerMove);
      },
      () => {
        window.removeEventListener('pointerup', onPointerUp);
      },
      () => {
        this.element.removeEventListener('wheel', onWheel);
      },
      () => {
        this.element.removeEventListener('contextmenu', onContextMenu);
      },
      () => {
        window.removeEventListener('keydown', onKeyDown);
      },
      () => {
        window.removeEventListener('keyup', onKeyUp);
      },
    );
  }

  /**
   * Касания (§8 ТЗ, мобильное управление).
   *
   * Один палец — панорама, два — зум и поворот, двойное касание — приближение к месту.
   * Короткое касание без движения панорамой не считается и уходит дальше как «нажали сюда»:
   * иначе на телефоне нельзя было бы ни выбрать жителя, ни поставить дом.
   */
  private touchDown(event: PointerEvent): void {
    this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.capture(event.pointerId);

    if (this.touches.size === 1) {
      this.tapStart = { x: event.clientX, y: event.clientY, at: performance.now() };
      this.pinch = null;
      return;
    }

    // Второй палец отменяет начатое касание: это жест камеры, а не нажатие по острову.
    this.tapStart = null;
    this.pinch = this.measurePinch();
  }

  private touchMove(event: PointerEvent): void {
    const previous = this.touches.get(event.pointerId);
    if (previous === undefined) return;
    this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.touches.size === 1) {
      if (this.tapStart !== null) {
        const moved = Math.hypot(event.clientX - this.tapStart.x, event.clientY - this.tapStart.y);
        // Пока палец стоит почти на месте, это ещё может оказаться нажатием, а не панорамой.
        if (moved < TAP_SLOP) return;
        this.tapStart = null;
      }
      // Сначала спрашиваем мир: в режиме строительства палец двигает призрак, а не остров.
      if (this.touchHost?.drag(event.clientX, event.clientY) === true) return;
      this.pan(event.clientX - previous.x, event.clientY - previous.y);
      return;
    }

    if (this.touches.size !== 2 || this.pinch === null) return;

    const now = this.measurePinch();
    if (now === null) return;

    this.desiredDistance = THREE.MathUtils.clamp(
      (this.desiredDistance * this.pinch.spread) / Math.max(now.spread, 1),
      MIN_DISTANCE,
      MAX_DISTANCE,
    );
    this.desiredYaw += now.angle - this.pinch.angle;
    this.pinch = now;
  }

  private touchUp(event: PointerEvent): void {
    const start = this.tapStart;
    this.touches.delete(event.pointerId);
    this.release(event.pointerId);

    if (this.touches.size < 2) this.pinch = null;
    if (this.touches.size === 0 && this.pinch === null) this.snapYaw();
    if (start === null) return;

    this.tapStart = null;
    const quick = performance.now() - start.at < TAP_MS;
    if (!quick) return;

    // Двойное касание — приближение к месту. Одиночное отдаётся дальше: его разбирает
    // тот, кто знает, что сейчас делает игрок, — правки мира.
    const double = performance.now() - this.lastTapAt < DOUBLE_TAP_MS;
    this.lastTapAt = performance.now();
    if (double) {
      this.desiredDistance = THREE.MathUtils.clamp(
        this.desiredDistance * 0.6,
        MIN_DISTANCE,
        MAX_DISTANCE,
      );
      this.lastTapAt = 0;
      return;
    }

    this.touchHost?.tap(start.x, start.y);
  }

  /**
   * Захват указателя. Браузер отказывает, если палец уже отпущен где-то ещё, и роняет
   * исключением всю обработку жеста — потерять из-за этого управление камерой нельзя.
   */
  private capture(pointerId: number): void {
    try {
      this.element.setPointerCapture(pointerId);
    } catch {
      // Не захватили — жест всё равно доедет через события на окне.
    }
  }

  private release(pointerId: number): void {
    try {
      if (this.element.hasPointerCapture(pointerId)) this.element.releasePointerCapture(pointerId);
    } catch {
      // См. выше.
    }
  }

  /** Расстояние между двумя пальцами и угол между ними: из них получаются зум и поворот. */
  private measurePinch(): { spread: number; angle: number } | null {
    const [a, b] = [...this.touches.values()];
    if (a === undefined || b === undefined) return null;
    return {
      spread: Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }

  private pan(dx: number, dy: number): void {
    // Скорость панорамы растёт с высотой: издалека остров пролистывается так же охотно.
    const speed = (this.distance * 0.0022) / Math.max(Math.sin(this.pitch), 0.35);
    const forwardX = -Math.cos(this.yaw);
    const forwardZ = -Math.sin(this.yaw);

    this.desiredTarget.x += (-dx * -forwardZ + dy * forwardX) * speed;
    this.desiredTarget.z += (-dx * forwardX + dy * forwardZ) * speed;

    this.desiredTarget.x = THREE.MathUtils.clamp(
      this.desiredTarget.x,
      -MARGIN,
      WORLD_WIDTH + MARGIN,
    );
    this.desiredTarget.z = THREE.MathUtils.clamp(
      this.desiredTarget.z,
      -MARGIN,
      WORLD_DEPTH + MARGIN,
    );
  }

  private rotate(dx: number, dy: number): void {
    this.desiredYaw += dx * 0.006;
    this.desiredPitch = THREE.MathUtils.clamp(this.desiredPitch - dy * 0.005, MIN_PITCH, MAX_PITCH);
  }

  private snapYaw(): void {
    this.desiredYaw = Math.round(this.desiredYaw / SNAP) * SNAP;
  }

  /**
   * Ставит камеру на место без перелёта. Нужно ровно один раз — когда после прибытия
   * управление отдаётся игроку: доехать туда плавно значило бы отнять у него ещё пару секунд.
   *
   * Направление тоже передаётся: если оставить своё, кадр сменился бы склейкой, и человек
   * потерял бы из виду и берег, и людей, на которых только что смотрел.
   */
  moveTo(point: THREE.Vector3, distance = 34, yaw?: number): void {
    this.desiredTarget.set(
      THREE.MathUtils.clamp(point.x, -MARGIN, WORLD_WIDTH + MARGIN),
      GROUND_Y,
      THREE.MathUtils.clamp(point.z, -MARGIN, WORLD_DEPTH + MARGIN),
    );
    this.target.copy(this.desiredTarget);
    this.desiredDistance = THREE.MathUtils.clamp(distance, MIN_DISTANCE, MAX_DISTANCE);
    this.distance = this.desiredDistance;

    if (yaw !== undefined) {
      // К ближайшим 45°: остров и после сцены стоит ровно, как везде в игре.
      this.desiredYaw = Math.round(yaw / SNAP) * SNAP;
      this.yaw = this.desiredYaw;
    }

    this.apply();
  }

  update(deltaSeconds: number): void {
    // Сглаживание, не зависящее от частоты кадров: на 30 и на 144 fps ощущается одинаково.
    const ease = 1 - Math.exp(-12 * deltaSeconds);

    this.target.lerp(this.desiredTarget, ease);
    this.distance += (this.desiredDistance - this.distance) * ease;
    this.yaw += (this.desiredYaw - this.yaw) * ease;
    this.pitch += (this.desiredPitch - this.pitch) * ease;

    this.apply();
  }

  private apply(): void {
    const horizontal = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      this.target.x + Math.cos(this.yaw) * horizontal,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.sin(this.yaw) * horizontal,
    );
    this.camera.lookAt(this.target);
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.detach.length = 0;
  }
}
