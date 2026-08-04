import { CHUNK_COUNT, chunkOrigin, VOXEL_SIZE } from '@gavan/shared';
import * as THREE from 'three';

import type { MeshPayload, MesherPool } from './mesherPool';

/**
 * Меши чанков. Один меш на чанк: 25 вызовов отрисовки при бюджете в 400 (§2 ТЗ).
 * Геометрия приезжает из воркеров готовой, главный поток только загружает её на видеокарту.
 */
export class Terrain {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<number, THREE.Mesh>();
  private readonly material: THREE.MeshLambertMaterial;

  constructor(private readonly pool: MesherPool) {
    // Цвет берётся из вершин: в них уже запечены и палитра, и затенение.
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
  }

  /** Ставит в очередь мешинг всех чанков. Готовые появляются по мере готовности. */
  async buildAll(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (let chunk = 0; chunk < CHUNK_COUNT; chunk += 1) {
      jobs.push(
        this.pool.mesh(chunk).then((payload) => {
          this.apply(payload);
        }),
      );
    }
    await Promise.all(jobs);
  }

  /** Перестраивает только указанные чанки. Понадобится при правке мира (M2.4). */
  async rebuild(chunks: Iterable<number>): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const chunk of chunks) {
      jobs.push(
        this.pool.mesh(chunk).then((payload) => {
          this.apply(payload);
        }),
      );
    }
    await Promise.all(jobs);
  }

  private apply(payload: MeshPayload): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(payload.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(payload.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(payload.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(payload.indices, 1));
    geometry.computeBoundingSphere();

    const existing = this.meshes.get(payload.chunk);
    if (existing !== undefined) {
      // Старую геометрию освобождаем сразу: за час игры иначе набегают сотни мегабайт.
      existing.geometry.dispose();
      existing.geometry = geometry;
      return;
    }

    const mesh = new THREE.Mesh(geometry, this.material);
    const origin = chunkOrigin(payload.chunk);
    mesh.position.set(origin.x * VOXEL_SIZE, 0, origin.z * VOXEL_SIZE);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    this.meshes.set(payload.chunk, mesh);
    this.group.add(mesh);
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) mesh.geometry.dispose();
    this.meshes.clear();
    this.material.dispose();
  }
}
