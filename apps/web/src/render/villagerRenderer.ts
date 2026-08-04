import { VOXEL_SIZE, villagerLook, type AgentState, type Villager } from '@gavan/shared';
import * as THREE from 'three';

/**
 * Жители: шесть коробок на человека плюс волосы, всё инстансами (§2.5 ТЗ).
 * Шестьдесят жителей — это чуть больше четырёхсот инстансов и семь вызовов отрисовки.
 *
 * Анимация процедурная: фаза шага гонит синус по рукам и ногам. Главное здесь не
 * правдоподобие, а читаемость — по позе и месту должно быть понятно, что человек делает.
 */

const MAX_VILLAGERS = 60;

interface PartSpec {
  name: string;
  size: [number, number, number];
  /** Смещение центра части от ног, в метрах. */
  offset: [number, number, number];
  color: 'skin' | 'hair' | 'cloth';
}

const PARTS: readonly PartSpec[] = [
  { name: 'legL', size: [0.16, 0.55, 0.16], offset: [-0.11, 0.275, 0], color: 'cloth' },
  { name: 'legR', size: [0.16, 0.55, 0.16], offset: [0.11, 0.275, 0], color: 'cloth' },
  { name: 'body', size: [0.42, 0.55, 0.24], offset: [0, 0.825, 0], color: 'cloth' },
  { name: 'armL', size: [0.12, 0.5, 0.12], offset: [-0.29, 0.83, 0], color: 'skin' },
  { name: 'armR', size: [0.12, 0.5, 0.12], offset: [0.29, 0.83, 0], color: 'skin' },
  { name: 'head', size: [0.32, 0.3, 0.3], offset: [0, 1.25, 0], color: 'skin' },
  { name: 'hair', size: [0.35, 0.12, 0.33], offset: [0, 1.44, 0], color: 'hair' },
];

/** Насколько «сложена» фигура в каждом состоянии: сидит, лежит или стоит. */
interface Pose {
  /** Наклон всего тела вперёд, радианы. */
  lean: number;
  /** Подъём или опускание над землёй, метры. */
  lift: number;
  /** Насколько сильно машут руки и ноги. */
  swing: number;
  /** Лежит ли житель — тогда фигура кладётся набок. */
  lying: boolean;
}

function poseFor(state: AgentState): Pose {
  switch (state) {
    case 'walk':
      return { lean: 0.06, lift: 0, swing: 1, lying: false };
    case 'sleep':
      // Спящий лежит: это единственная поза, которую видно с любого зума без сомнений.
      return { lean: 0, lift: -0.55, swing: 0, lying: true };
    case 'socialize':
    case 'eat':
      // Сидит: колени согнуты, фигура ниже на треть роста.
      return { lean: 0.12, lift: -0.45, swing: 0.12, lying: false };
    case 'admire':
      return { lean: -0.12, lift: -0.45, swing: 0.05, lying: false };
    case 'work':
    case 'build':
    case 'haul':
      return { lean: 0.45, lift: -0.08, swing: 0.7, lying: false };
    case 'celebrate':
      return { lean: -0.05, lift: 0, swing: 1.2, lying: false };
    default:
      return { lean: 0, lift: 0, swing: 0.08, lying: false };
  }
}

export class VillagerRenderer {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<string, THREE.InstancedMesh>();
  private phase = 0;

  constructor() {
    for (const part of PARTS) {
      const geometry = new THREE.BoxGeometry(...part.size);
      const mesh = new THREE.InstancedMesh(
        geometry,
        new THREE.MeshLambertMaterial({ color: 0xffffff }),
        MAX_VILLAGERS,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.meshes.set(part.name, mesh);
      this.group.add(mesh);
    }
  }

  /**
   * Ставит жителей по местам. `alpha` — доля пути между двумя тиками: решения принимаются
   * раз в десять секунд, а рисовать надо шестьдесят раз в секунду.
   */
  update(
    villagers: readonly Villager[],
    previous: readonly Villager[],
    alpha: number,
    deltaSeconds: number,
  ): void {
    this.phase += deltaSeconds * 6;

    const before = new Map(previous.map((villager) => [villager.id, villager]));
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const tint = new THREE.Color();
    const yAxis = new THREE.Vector3(0, 1, 0);

    for (const mesh of this.meshes.values()) mesh.count = Math.min(villagers.length, MAX_VILLAGERS);

    villagers.forEach((villager, index) => {
      if (index >= MAX_VILLAGERS) return;

      const from = before.get(villager.id) ?? villager;
      const x = lerp(from.position.x, villager.position.x, alpha);
      const y = lerp(from.position.y, villager.position.y, alpha);
      const z = lerp(from.position.z, villager.position.z, alpha);

      const dx = villager.position.x - from.position.x;
      const dz = villager.position.z - from.position.z;
      const moving = Math.abs(dx) + Math.abs(dz) > 0.001;
      const yaw = moving ? Math.atan2(dx, dz) : hashYaw(villager.seed);

      const look = villagerLook(villager.seed);
      const pose = poseFor(villager.state);
      const step = moving ? Math.sin(this.phase + (villager.seed % 6)) : 0;

      const groundY = (y - 1) * VOXEL_SIZE + VOXEL_SIZE;
      const rootX = (x + 0.5) * VOXEL_SIZE;
      const rootZ = (z + 0.5) * VOXEL_SIZE;

      for (const part of PARTS) {
        const mesh = this.meshes.get(part.name);
        if (mesh === undefined) continue;

        const swing = step * pose.swing * swingSign(part.name);
        const [ox, oy, oz] = part.offset;

        // Руки и ноги качаются вдоль движения; всё остальное едет вместе с корпусом.
        const localZ = oz + swing * 0.22;
        const localY = oy * look.height + pose.lift + (pose.lying ? -oy * look.height * 0.55 : 0);

        position.set(rootX, groundY + localY, rootZ);
        // Смещение по бокам и вперёд считаем в системе координат жителя.
        const sin = Math.sin(yaw);
        const cos = Math.cos(yaw);
        position.x += ox * cos + localZ * sin;
        position.z += -ox * sin + localZ * cos;

        quaternion.setFromAxisAngle(yAxis, yaw);
        if (pose.lying || pose.lean !== 0) {
          const tilt = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0),
            pose.lying ? Math.PI / 2 : pose.lean,
          );
          quaternion.multiply(tilt);
        }

        scale.set(1, look.height, 1);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, matrix);

        tint.setHex(look[part.color]);
        mesh.setColorAt(index, tint);
      }
    });

    for (const mesh of this.meshes.values()) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) {
      mesh.geometry.dispose();
      if (!Array.isArray(mesh.material)) mesh.material.dispose();
      mesh.dispose();
    }
    this.meshes.clear();
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Руки качаются противоходом ногам — иначе человек идёт как заводная игрушка. */
function swingSign(part: string): number {
  if (part === 'legL' || part === 'armR') return 1;
  if (part === 'legR' || part === 'armL') return -1;
  return 0;
}

/** Куда смотрит тот, кто стоит: не строго на север, но и не наугад каждый кадр. */
function hashYaw(seed: number): number {
  return ((seed % 360) / 360) * Math.PI * 2;
}
