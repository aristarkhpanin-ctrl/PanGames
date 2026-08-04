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

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly element: HTMLElement,
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
      if (this.lastPointer === null) return;
      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      this.lastPointer = { x: event.clientX, y: event.clientY };

      if (this.panning) this.pan(dx, dy);
      else if (this.rotating) this.rotate(dx, dy);
    };

    const onPointerUp = (event: PointerEvent): void => {
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
