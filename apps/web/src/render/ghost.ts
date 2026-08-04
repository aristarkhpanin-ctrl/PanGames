import { buildingType, footprintOf, Palette, VOXEL_SIZE } from '@gavan/shared';
import * as THREE from 'three';

import { rotateBox } from './buildingRenderer';

/**
 * Призрак здания под курсором (M4.2).
 *
 * Полупрозрачная форма показывает, что именно встанет и как оно повёрнуто, а цвет отвечает
 * на единственный вопрос перед нажатием: встанет или нет. Никаких значков и подписей —
 * ответ читается сразу (§8 ТЗ).
 */
export class Ghost {
  readonly group = new THREE.Group();
  private readonly material = new THREE.MeshBasicMaterial({
    color: Palette.lamp,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });

  private readonly frameMaterial = new THREE.LineBasicMaterial({
    color: Palette.lamp,
    transparent: true,
    opacity: 0.9,
  });

  private readonly frame = new THREE.LineSegments(new THREE.BufferGeometry(), this.frameMaterial);

  private readonly meshes: THREE.Mesh[] = [];
  private shownFor = '';

  constructor() {
    this.group.visible = false;
    this.group.add(this.frame);
    this.group.renderOrder = 2;
  }

  show(
    typeId: string,
    pos: { x: number; y: number; z: number },
    rotation: 0 | 1 | 2 | 3,
    valid: boolean,
  ): void {
    const type = buildingType(typeId);
    if (type === undefined) {
      this.hide();
      return;
    }

    // Форма пересобирается только при смене здания или поворота: при протяжке мышью
    // достаточно подвинуть готовую группу.
    const key = `${typeId}:${String(rotation)}`;
    if (key !== this.shownFor) {
      this.rebuild(typeId, rotation);
      this.shownFor = key;
    }

    this.group.position.set(pos.x * VOXEL_SIZE, pos.y * VOXEL_SIZE, pos.z * VOXEL_SIZE);
    const color = valid ? Palette.lamp : Palette.bloom;
    this.material.color.setHex(color);
    this.frameMaterial.color.setHex(color);
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }

  private rebuild(typeId: string, rotation: 0 | 1 | 2 | 3): void {
    for (const mesh of this.meshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes.length = 0;

    const type = buildingType(typeId);
    if (type === undefined) return;

    for (const box of type.shape) {
      const rotated = rotateBox(box, rotation, type.footprint);
      const geometry = new THREE.BoxGeometry(
        rotated.w * VOXEL_SIZE,
        box.h * VOXEL_SIZE,
        rotated.d * VOXEL_SIZE,
      );
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.position.set(
        (rotated.x + rotated.w / 2) * VOXEL_SIZE,
        (box.y + box.h / 2) * VOXEL_SIZE,
        (rotated.z + rotated.d / 2) * VOXEL_SIZE,
      );
      this.meshes.push(mesh);
      this.group.add(mesh);
    }

    const size = footprintOf(type, rotation);
    this.frame.geometry.dispose();
    this.frame.geometry = footprintOutline(size.w, size.d);
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.geometry.dispose();
    this.meshes.length = 0;
    this.frame.geometry.dispose();
    this.frameMaterial.dispose();
    this.material.dispose();
  }
}

/** Контур участка по земле: видно, сколько места займёт здание, даже если оно узкое. */
function footprintOutline(w: number, d: number): THREE.BufferGeometry {
  const y = 0.02;
  const x1 = w * VOXEL_SIZE;
  const z1 = d * VOXEL_SIZE;

  const corners: [number, number][] = [
    [0, 0],
    [x1, 0],
    [x1, z1],
    [0, z1],
  ];

  const positions: number[] = [];
  for (let i = 0; i < corners.length; i += 1) {
    const from = corners[i];
    const to = corners[(i + 1) % corners.length];
    if (from === undefined || to === undefined) continue;
    positions.push(from[0], y, from[1], to[0], y, to[1]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}
