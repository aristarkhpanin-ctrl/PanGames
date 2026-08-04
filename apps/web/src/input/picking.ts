import { isOpaque, raycastVoxels, VOXEL_SIZE, type RayHit } from '@gavan/shared';
import * as THREE from 'three';

import type { LiveWorld } from '../state/liveWorld';

/**
 * Пикинг вокселей рейкастом (M2.2).
 *
 * Луч идёт по данным мира, а не по геометрии мешей: greedy meshing склеивает грани в крупные
 * прямоугольники, и попадание по такому прямоугольнику ничего не говорит о том, в какой именно
 * воксель ткнул игрок. Заодно пикинг не зависит от того, успел ли чанк перестроиться.
 */

/** Дальше этого не тыкаем: остров всего 80 метров в поперечнике. */
const MAX_REACH_VOXELS = 260;

export class Picker {
  private readonly ray = new THREE.Ray();
  private readonly pointer = new THREE.Vector2();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly world: LiveWorld,
  ) {}

  /** Что под курсором. Координаты экранные, в пикселях канваса. */
  at(x: number, y: number, width: number, height: number): RayHit | null {
    this.pointer.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
    this.ray.origin.setFromMatrixPosition(this.camera.matrixWorld);
    this.ray.direction
      .set(this.pointer.x, this.pointer.y, 0.5)
      .unproject(this.camera)
      .sub(this.ray.origin)
      .normalize();

    // Мир меряется вокселями, сцена — метрами.
    return raycastVoxels(
      this.ray.origin.x / VOXEL_SIZE,
      this.ray.origin.y / VOXEL_SIZE,
      this.ray.origin.z / VOXEL_SIZE,
      this.ray.direction.x,
      this.ray.direction.y,
      this.ray.direction.z,
      MAX_REACH_VOXELS,
      (vx, vy, vz) => isOpaque(this.world.material(vx, vy, vz)),
    );
  }
}
