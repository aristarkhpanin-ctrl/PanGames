import { VOXEL_SIZE, type PlacedBuilding } from '@gavan/shared';
import * as THREE from 'three';

/**
 * Режим «Смотреть» (§8 ТЗ). Вторая signature-фича: «Это и есть продукт».
 *
 * Камера медленно облетает остров по кривой, построенной **по фактическим постройкам**,
 * а не по фиксированному кругу: показывать надо то, что игрок построил. Если строек ещё
 * нет, облёт идёт вокруг середины острова.
 *
 * Медленно — это требование, а не недоработка. Ни целей, ни подсказок, ни таймера.
 */

/** Сколько секунд занимает полный круг. Двухминутный облёт — это очень медленно, и так надо. */
const LOOP_SECONDS = 120;

/**
 * Насколько высоко и далеко идёт камера.
 *
 * Пока строек нет, показывать нечего кроме острова целиком — камера отходит и поднимается.
 * Как только появились кварталы, она снижается к ним: смотреть надо на то, что построено.
 */
const EMPTY_VIEW = { radius: 58, height: 30 };
const BUILT_VIEW = { radius: 34, height: 18 };

/** На сколько метров взгляд поднят над землёй. Ноль означал бы смотреть себе под ноги. */
const LOOK_ABOVE_GROUND = 7;

export class WatchMode {
  private time = 0;
  /** Первый кадр после входа камера не подъезжает, а встаёт: иначе она летит сквозь деревья. */
  private snap = true;
  private readonly focus = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();

  /** Точки, мимо которых стоит пройти: жилые кварталы и вода. */
  private waypoints: THREE.Vector3[] = [];

  /** Есть ли что показывать вблизи. Пока нет — камера смотрит на остров целиком. */
  private hasBuildings = false;

  /**
   * `prefers-reduced-motion` отключает облёт: камера стоит и медленно поворачивается
   * на месте (§8 ТЗ, доступность).
   */
  private readonly reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Пересобирает маршрут по тому, что на острове стоит сейчас. */
  planRoute(buildings: readonly PlacedBuilding[], center: THREE.Vector3): void {
    const built = buildings.filter((building) => building.progress >= 1);

    this.hasBuildings = built.length > 0;

    if (built.length === 0) {
      this.waypoints = [center.clone()];
      return;
    }

    // Кварталы: здания сбиваются в кучки, и облёт идёт по кучкам, а не по каждому дому.
    const clusters: THREE.Vector3[] = [];
    for (const building of built) {
      const point = new THREE.Vector3(
        building.x * VOXEL_SIZE,
        building.y * VOXEL_SIZE,
        building.z * VOXEL_SIZE,
      );
      const near = clusters.find((cluster) => cluster.distanceTo(point) < 14);
      if (near === undefined) clusters.push(point);
      else near.lerp(point, 0.5);
    }

    // По часовой стрелке вокруг центра: иначе камера мечется между дальними кварталами.
    clusters.sort(
      (a, b) =>
        Math.atan2(a.z - center.z, a.x - center.x) - Math.atan2(b.z - center.z, b.x - center.x),
    );

    this.waypoints = clusters;
  }

  /** Ставит камеру на следующий кадр облёта. */
  update(camera: THREE.PerspectiveCamera, center: THREE.Vector3, delta: number): void {
    this.time += delta;
    const phase = (this.time / LOOP_SECONDS) % 1;

    const view = this.hasBuildings ? BUILT_VIEW : EMPTY_VIEW;

    if (this.reducedMotion) {
      // Камера стоит; поворачивается только взгляд, и очень медленно.
      this.eye.set(center.x + view.radius, center.y + view.height, center.z + view.radius);
      this.focus.copy(center);
      this.focus.y += LOOK_ABOVE_GROUND;
      this.focus.x += Math.cos(phase * Math.PI * 2) * 12;
      this.focus.z += Math.sin(phase * Math.PI * 2) * 12;
    } else {
      const target = this.pointAt(phase, center);
      // Камера идёт по кругу вокруг цели, а цель плывёт по маршруту: получается кривая,
      // а не карусель.
      const angle = phase * Math.PI * 2;
      if (this.snap) this.focus.copy(target);
      else this.focus.lerp(target, Math.min(1, delta * 0.6));
      this.focus.y = target.y + LOOK_ABOVE_GROUND;

      this.eye.set(
        this.focus.x + Math.cos(angle) * view.radius,
        this.focus.y + view.height,
        this.focus.z + Math.sin(angle) * view.radius,
      );
    }

    if (this.snap) {
      camera.position.copy(this.eye);
      this.snap = false;
    } else {
      camera.position.lerp(this.eye, Math.min(1, delta * 0.8));
    }
    camera.lookAt(this.focus);
  }

  /** Куда смотреть в этот момент облёта. */
  private pointAt(phase: number, center: THREE.Vector3): THREE.Vector3 {
    if (this.waypoints.length === 0) return center;

    const scaled = phase * this.waypoints.length;
    const index = Math.floor(scaled) % this.waypoints.length;
    const next = (index + 1) % this.waypoints.length;

    const from = this.waypoints[index] ?? center;
    const to = this.waypoints[next] ?? center;
    return from.clone().lerp(to, scaled - Math.floor(scaled));
  }

  /** Сбрасывает облёт к началу: вход в режим всегда начинается с одного и того же места. */
  reset(): void {
    this.time = 0;
    this.snap = true;
  }
}
