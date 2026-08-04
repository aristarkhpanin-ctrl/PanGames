import { Palette, VOXEL_SIZE, type RayHit } from '@gavan/shared';
import * as THREE from 'three';

/**
 * Подсветка того, во что сейчас указывает курсор: тонкая рамка вокруг клеток кисти.
 * Без мигания и пульсации — игра про спокойствие, и курсор об этом сообщает первым.
 */
export class Highlight {
  readonly object: THREE.LineSegments;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.LineBasicMaterial;

  constructor() {
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));

    this.material = new THREE.LineBasicMaterial({
      color: Palette.lamp,
      transparent: true,
      opacity: 0.9,
      // Рамка видна и когда клетка спрятана за холмом: иначе курсор пропадает под рельефом.
      depthTest: false,
    });

    this.object = new THREE.LineSegments(this.geometry, this.material);
    this.object.renderOrder = 3;
    this.object.visible = false;
  }

  /** `cells` — клетки, которые затронет кисть. Пустой список прячет рамку. */
  show(cells: readonly { x: number; y: number; z: number }[], valid: boolean): void {
    if (cells.length === 0) {
      this.object.visible = false;
      return;
    }

    const positions: number[] = [];
    for (const cell of cells) addBoxEdges(positions, cell.x, cell.y, cell.z);

    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.geometry.computeBoundingSphere();
    // Отказ показывается цветом рамки, а не всплывающим окном.
    this.material.color.setHex(valid ? Palette.lamp : Palette.bloom);
    this.object.visible = true;
  }

  hide(): void {
    this.object.visible = false;
  }

  hitCells(hit: RayHit, radius: number, place: boolean): { x: number; y: number; z: number }[] {
    // При насыпании кисть работает по соседней клетке — той, из которой пришёл луч.
    const base = {
      x: hit.x + (place ? hit.nx : 0),
      y: hit.y + (place ? hit.ny : 0),
      z: hit.z + (place ? hit.nz : 0),
    };

    if (radius === 0) return [base];

    // Кисть раскрывается в плоскости грани: по склону она ложится вдоль склона.
    const cells: { x: number; y: number; z: number }[] = [];
    for (let a = -radius; a <= radius; a += 1) {
      for (let b = -radius; b <= radius; b += 1) {
        if (hit.ny !== 0) cells.push({ x: base.x + a, y: base.y, z: base.z + b });
        else if (hit.nx !== 0) cells.push({ x: base.x, y: base.y + a, z: base.z + b });
        else cells.push({ x: base.x + a, y: base.y + b, z: base.z });
      }
    }
    return cells;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Двенадцать рёбер куба одной клетки, чуть раздутых, чтобы рамка не тонула в поверхности. */
function addBoxEdges(out: number[], x: number, y: number, z: number): void {
  const pad = 0.012;
  const x0 = x * VOXEL_SIZE - pad;
  const y0 = y * VOXEL_SIZE - pad;
  const z0 = z * VOXEL_SIZE - pad;
  const x1 = (x + 1) * VOXEL_SIZE + pad;
  const y1 = (y + 1) * VOXEL_SIZE + pad;
  const z1 = (z + 1) * VOXEL_SIZE + pad;

  const corners: [number, number, number][] = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y0, z1],
    [x0, y0, z1],
    [x0, y1, z0],
    [x1, y1, z0],
    [x1, y1, z1],
    [x0, y1, z1],
  ];

  const edges: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];

  for (const [from, to] of edges) {
    const a = corners[from];
    const b = corners[to];
    if (a === undefined || b === undefined) continue;
    out.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
}
