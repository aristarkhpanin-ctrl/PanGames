import {
  createRng,
  materialColor,
  Material,
  PLANTS,
  plantKind,
  VOXEL_SIZE,
  type PlantInstance,
} from '@gavan/shared';
import * as THREE from 'three';

/**
 * Посаженные растения — инстансы по видам (§2.4 ТЗ). Их сотни, а вызовов отрисовки
 * столько же, сколько видов, и посадка не заставляет перестраивать меш чанка.
 *
 * Разброс размера и поворота выводится из сида растения: хранить их по полям незачем,
 * а выглядеть одинаковыми клумбы не должны.
 */
export class Plants {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<string, THREE.InstancedMesh[]>();

  /** Пересобирает инстансы под текущий список. Растений мало, полная пересборка дешевле учёта. */
  rebuild(plants: readonly PlantInstance[]): void {
    this.clear();

    for (const kind of PLANTS) {
      const ofKind = plants.filter((plant) => plant.kind === kind.id);
      if (ofKind.length === 0) continue;

      // Шапка и стебель — две части одного растения. У цветка шапка сидит на стебле,
      // у куста и пучка травы стебля нет вовсе, и шапка стоит прямо на земле.
      const parts: THREE.InstancedMesh[] = [];
      if (kind.stem) {
        parts.push(buildPart(ofKind, 0.08, kind.height * 0.7, 0, Material.LEAVES, false));
        parts.push(
          buildPart(
            ofKind,
            kind.width,
            kind.height * 0.45,
            kind.height * 0.55,
            kind.material,
            true,
          ),
        );
      } else {
        parts.push(buildPart(ofKind, kind.width, kind.height, 0, kind.material, true));
      }

      this.meshes.set(kind.id, parts);
      for (const part of parts) this.group.add(part);
    }
  }

  private clear(): void {
    for (const parts of this.meshes.values()) {
      for (const mesh of parts) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        if (!Array.isArray(mesh.material)) mesh.material.dispose();
        mesh.dispose();
      }
    }
    this.meshes.clear();
  }

  dispose(): void {
    this.clear();
  }
}

/**
 * Одна часть растения инстансами.
 * `bottom` — на какой высоте над землёй начинается часть, до умножения на разброс размера.
 */
function buildPart(
  plants: readonly PlantInstance[],
  width: number,
  height: number,
  bottom: number,
  material: number,
  castsShadow: boolean,
): THREE.InstancedMesh {
  const geometry = new THREE.BoxGeometry(width, height, width);
  const mesh = new THREE.InstancedMesh(
    geometry,
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    plants.length,
  );
  mesh.castShadow = castsShadow;
  mesh.receiveShadow = true;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();
  const base = new THREE.Color(materialColor(material));

  plants.forEach((plant, index) => {
    const rng = createRng(plant.seed);
    const size = rng.range(0.85, 1.2);
    const rotation = rng.range(0, Math.PI * 2);
    // Небольшой сдвиг внутри клетки: ровные ряды выдают, что это сетка.
    const offsetX = rng.range(-0.15, 0.15);
    const offsetZ = rng.range(-0.15, 0.15);

    // Геометрия центрирована в начале координат, поэтому к низу добавляем половину высоты.
    const ground = (plant.y + 1) * VOXEL_SIZE;
    position.set(
      (plant.x + 0.5) * VOXEL_SIZE + offsetX,
      ground + (bottom + height / 2) * size,
      (plant.z + 0.5) * VOXEL_SIZE + offsetZ,
    );

    quaternion.setFromAxisAngle(axis, rotation);
    scale.setScalar(size);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);

    tint.copy(base).multiplyScalar(rng.range(0.88, 1.12));
    mesh.setColorAt(index, tint);
  });

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

/** Есть ли такой вид в каталоге — нужно интерфейсу выбора. */
export function isKnownPlant(id: string): boolean {
  return plantKind(id) !== undefined;
}
