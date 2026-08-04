import {
  materialColor,
  Material,
  Palette,
  VOXEL_SIZE,
  type TreeInstance,
  type TreeKind,
} from '@gavan/shared';
import * as THREE from 'three';

/**
 * Деревья — инстансы, а не воксели чанка (§2.4 ТЗ): сотни стволов рисуются несколькими
 * вызовами, и посадка дерева не заставляет перестраивать меш целого чанка.
 *
 * Форма нарочно грубая: силуэт должен читаться с любого зума, а деталей в этом стиле нет.
 */

interface KindShape {
  trunkHeight: number;
  trunkWidth: number;
  crownHeight: number;
  crownWidth: number;
  /** Насколько крона надвинута на ствол, чтобы между ними не было щели. */
  crownOverlap: number;
}

const SHAPES: Record<TreeKind, KindShape> = {
  broadleaf: {
    trunkHeight: 1.9,
    trunkWidth: 0.35,
    crownHeight: 1.9,
    crownWidth: 2.0,
    crownOverlap: 0.5,
  },
  pine: { trunkHeight: 2.2, trunkWidth: 0.3, crownHeight: 2.6, crownWidth: 1.4, crownOverlap: 0.7 },
  palm: {
    trunkHeight: 2.8,
    trunkWidth: 0.28,
    crownHeight: 0.6,
    crownWidth: 2.6,
    crownOverlap: 0.2,
  },
};

const KINDS: readonly TreeKind[] = ['broadleaf', 'pine', 'palm'];

export class Decor {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];

  constructor(trees: readonly TreeInstance[]) {
    for (const kind of KINDS) {
      const ofKind = trees.filter((tree) => tree.kind === kind);
      if (ofKind.length === 0) continue;

      const shape = SHAPES[kind];
      this.group.add(this.buildPart(ofKind, shape, true));
      this.group.add(this.buildPart(ofKind, shape, false));
    }
  }

  private buildPart(
    trees: readonly TreeInstance[],
    shape: KindShape,
    isTrunk: boolean,
  ): THREE.InstancedMesh {
    const geometry = isTrunk
      ? new THREE.BoxGeometry(shape.trunkWidth, shape.trunkHeight, shape.trunkWidth)
      : new THREE.BoxGeometry(shape.crownWidth, shape.crownHeight, shape.crownWidth);

    // Чистый leafShade для кроны слишком тёмный: массив деревьев сливался в чёрный ковёр.
    // Подмешиваем светлую зелень палитры, оставляя листву темнее травы под ней.
    const baseColor = isTrunk
      ? new THREE.Color(materialColor(Material.WOOD))
      : new THREE.Color(materialColor(Material.LEAVES)).lerp(new THREE.Color(Palette.leaf), 0.45);
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff });

    const mesh = new THREE.InstancedMesh(geometry, material, trees.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();

    trees.forEach((tree, index) => {
      // tree.y — верхний твёрдый воксель, поэтому земля под деревом это его верхняя грань.
      const ground = (tree.y + 1) * VOXEL_SIZE;
      const trunkTop = ground + shape.trunkHeight * tree.scale;

      // Геометрия центрирована в начале координат, поэтому смещаем на половину высоты.
      position.set(
        (tree.x + 0.5) * VOXEL_SIZE,
        isTrunk
          ? ground + (shape.trunkHeight * tree.scale) / 2
          : trunkTop - shape.crownOverlap * tree.scale + (shape.crownHeight * tree.scale) / 2,
        (tree.z + 0.5) * VOXEL_SIZE,
      );

      quaternion.setFromAxisAngle(axis, tree.rotation);
      scale.setScalar(tree.scale);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);

      // Небольшой разброс тона: одинаковые кроны выдают, что дерево одно и то же.
      const shade = 0.86 + ((tree.x * 7 + tree.z * 13) % 12) / 42;
      tint.copy(baseColor).multiplyScalar(shade);
      mesh.setColorAt(index, tint);
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    this.meshes.push(mesh);
    return mesh;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) for (const item of mesh.material) item.dispose();
      else mesh.material.dispose();
      mesh.dispose();
    }
    this.meshes.length = 0;
  }
}
