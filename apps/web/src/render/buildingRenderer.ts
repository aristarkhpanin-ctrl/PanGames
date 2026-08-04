import {
  buildingType,
  footprintOf,
  materialColor,
  VOXEL_SIZE,
  type PlacedBuilding,
  type ShapeBox,
} from '@gavan/shared';
import * as THREE from 'three';

/**
 * Отрисовка зданий из их формы (§6 ТЗ).
 *
 * Форма — данные: список коробок в каталоге. Поэтому здесь нет ни одного ветвления
 * по идентификатору здания, и новое здание рисуется само.
 *
 * Стройка видна сразу каркасом, а прогресс показывается вертикальным нарастанием:
 * дом поднимается снизу вверх, и по нему видно, сколько осталось.
 */
export class BuildingRenderer {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];

  /** Полная пересборка. Зданий не больше 250, и учёт по одному дороже пересборки. */
  rebuild(buildings: readonly PlacedBuilding[]): void {
    this.clear();

    // Коробки собираются в одну геометрию на материал: 250 зданий укладываются
    // в единицы вызовов отрисовки вместо тысяч.
    const byMaterial = new Map<number, THREE.BoxGeometry[]>();
    const matrix = new THREE.Matrix4();

    for (const building of buildings) {
      const type = buildingType(building.typeId);
      if (type === undefined) continue;

      const size = footprintOf(type, building.rotation);
      // Пока строят, показываем нижнюю часть: здание растёт снизу вверх.
      const shapeHeight = Math.max(...type.shape.map((box) => box.y + box.h), 1);
      const visibleHeight = Math.max(1, Math.ceil(shapeHeight * building.progress));

      for (const box of type.shape) {
        if (building.progress < 1 && box.y >= visibleHeight) continue;

        const height = building.progress < 1 ? Math.min(box.h, visibleHeight - box.y) : box.h;
        if (height <= 0) continue;

        const rotated = rotateBox(box, building.rotation, type.footprint);
        const geometry = new THREE.BoxGeometry(
          rotated.w * VOXEL_SIZE,
          height * VOXEL_SIZE,
          rotated.d * VOXEL_SIZE,
        );

        matrix.makeTranslation(
          (building.x + rotated.x + rotated.w / 2) * VOXEL_SIZE,
          (building.y + box.y + height / 2) * VOXEL_SIZE,
          (building.z + rotated.z + rotated.d / 2) * VOXEL_SIZE,
        );
        geometry.applyMatrix4(matrix);

        const list = byMaterial.get(box.mat) ?? [];
        list.push(geometry);
        byMaterial.set(box.mat, list);
      }

      // Недостроенное здание обозначено угловыми столбиками — стройплощадка видна сразу.
      if (building.progress < 1) {
        for (const post of cornerPosts(building, size)) {
          const list = byMaterial.get(post.mat) ?? [];
          list.push(post.geometry);
          byMaterial.set(post.mat, list);
        }
      }
    }

    for (const [material, geometries] of byMaterial) {
      const merged = mergeGeometries(geometries);
      if (merged === null) continue;

      const mesh = new THREE.Mesh(
        merged,
        new THREE.MeshLambertMaterial({ color: materialColor(material) }),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  private clear(): void {
    for (const mesh of this.meshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      if (!Array.isArray(mesh.material)) mesh.material.dispose();
    }
    this.meshes.length = 0;
  }

  dispose(): void {
    this.clear();
  }
}

/** Поворот коробки внутри участка на 90° шагами. */
export function rotateBox(
  box: ShapeBox,
  rotation: 0 | 1 | 2 | 3,
  footprint: { w: number; d: number },
): { x: number; z: number; w: number; d: number } {
  switch (rotation) {
    case 1:
      return { x: footprint.d - box.z - box.d, z: box.x, w: box.d, d: box.w };
    case 2:
      return { x: footprint.w - box.x - box.w, z: footprint.d - box.z - box.d, w: box.w, d: box.d };
    case 3:
      return { x: box.z, z: footprint.w - box.x - box.w, w: box.d, d: box.w };
    default:
      return { x: box.x, z: box.z, w: box.w, d: box.d };
  }
}

function cornerPosts(
  building: PlacedBuilding,
  size: { w: number; d: number },
): { geometry: THREE.BoxGeometry; mat: number }[] {
  const posts: { geometry: THREE.BoxGeometry; mat: number }[] = [];
  const matrix = new THREE.Matrix4();

  for (const [dx, dz] of [
    [0, 0],
    [size.w - 1, 0],
    [0, size.d - 1],
    [size.w - 1, size.d - 1],
  ]) {
    const geometry = new THREE.BoxGeometry(VOXEL_SIZE * 0.3, VOXEL_SIZE * 2, VOXEL_SIZE * 0.3);
    matrix.makeTranslation(
      (building.x + (dx ?? 0) + 0.5) * VOXEL_SIZE,
      (building.y + 1) * VOXEL_SIZE,
      (building.z + (dz ?? 0) + 0.5) * VOXEL_SIZE,
    );
    geometry.applyMatrix4(matrix);
    posts.push({ geometry, mat: 7 });
  }

  return posts;
}

/** Склейка геометрий вручную: тянуть ради этого целый пакет незачем. */
function mergeGeometries(geometries: readonly THREE.BoxGeometry[]): THREE.BufferGeometry | null {
  if (geometries.length === 0) return null;

  let vertexCount = 0;
  let indexCount = 0;
  for (const geometry of geometries) {
    vertexCount += geometry.attributes.position?.count ?? 0;
    indexCount += geometry.index?.count ?? 0;
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);

  let vertexOffset = 0;
  let indexOffset = 0;

  for (const geometry of geometries) {
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const index = geometry.index;
    if (position === undefined || normal === undefined || index === null) continue;

    positions.set(position.array, vertexOffset * 3);
    normals.set(normal.array, vertexOffset * 3);
    for (let i = 0; i < index.count; i += 1) {
      indices[indexOffset + i] = (index.array[i] ?? 0) + vertexOffset;
    }

    vertexOffset += position.count;
    indexOffset += index.count;
    geometry.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingSphere();
  return merged;
}
