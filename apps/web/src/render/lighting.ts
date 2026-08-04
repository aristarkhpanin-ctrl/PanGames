import * as THREE from 'three';

/**
 * Свет и цикл суток (§2.5, §3 ТЗ): одно направленное солнце плюс полусферический подсвет.
 * Тени мягкие, только от солнца, один каскад вокруг камеры.
 *
 * Ночь здесь — не помеха, а самое красивое время: на неё работает режим «Смотреть» (M7.5),
 * поэтому тёмные часы подсвечены холодным небом, а не выключены в чёрное.
 */

interface SkyKeyframe {
  hour: number;
  sun: number;
  sunIntensity: number;
  sky: number;
  ground: number;
  hemisphere: number;
  fog: number;
}

/** Опорные точки суток. Между ними цвета плавно смешиваются. */
const KEYFRAMES: readonly SkyKeyframe[] = [
  {
    hour: 0,
    sun: 0x2a3f66,
    sunIntensity: 0.08,
    sky: 0x0b1a2a,
    ground: 0x0a1420,
    hemisphere: 0.3,
    fog: 0x0b1a2a,
  },
  {
    hour: 5,
    sun: 0x4a5a80,
    sunIntensity: 0.16,
    sky: 0x1d3350,
    ground: 0x121e2c,
    hemisphere: 0.38,
    fog: 0x1d3350,
  },
  {
    hour: 7,
    sun: 0xffb877,
    sunIntensity: 1.05,
    sky: 0x7fa8c4,
    ground: 0x6b6552,
    hemisphere: 0.6,
    fog: 0x9fb8c6,
  },
  {
    hour: 12,
    sun: 0xfff4e0,
    sunIntensity: 1.45,
    sky: 0xa8ccdd,
    ground: 0x7d8a70,
    hemisphere: 0.75,
    fog: 0xb8d2de,
  },
  {
    hour: 17,
    sun: 0xffd9a0,
    sunIntensity: 1.2,
    sky: 0x9fc0d4,
    ground: 0x7a7a62,
    hemisphere: 0.65,
    fog: 0xaec8d6,
  },
  {
    hour: 19,
    sun: 0xff9b5e,
    sunIntensity: 0.62,
    sky: 0x6d7fa0,
    ground: 0x4d4f4c,
    hemisphere: 0.5,
    fog: 0x8e94ad,
  },
  {
    hour: 21,
    sun: 0x3a4a72,
    sunIntensity: 0.16,
    sky: 0x1a2b44,
    ground: 0x121c2a,
    hemisphere: 0.35,
    fog: 0x1a2b44,
  },
  {
    hour: 24,
    sun: 0x2a3f66,
    sunIntensity: 0.08,
    sky: 0x0b1a2a,
    ground: 0x0a1420,
    hemisphere: 0.3,
    fog: 0x0b1a2a,
  },
];

export interface SkyState {
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  skyColor: THREE.Color;
  groundColor: THREE.Color;
  hemisphereIntensity: number;
  fogColor: THREE.Color;
}

/** Наклон плоскости, по которой ходит солнце: тени не встают строго вертикально в полдень. */
const SUN_PLANE = 0.6;

export function skyAt(hour: number): SkyState {
  const time = ((hour % 24) + 24) % 24;

  let before = KEYFRAMES[0] ?? KEYFRAMES[0];
  let after = KEYFRAMES[KEYFRAMES.length - 1];
  for (let i = 0; i < KEYFRAMES.length - 1; i += 1) {
    const current = KEYFRAMES[i];
    const next = KEYFRAMES[i + 1];
    if (current === undefined || next === undefined) continue;
    if (time >= current.hour && time <= next.hour) {
      before = current;
      after = next;
      break;
    }
  }
  if (before === undefined || after === undefined) throw new Error('Цикл суток повреждён');

  const span = after.hour - before.hour;
  const t = span === 0 ? 0 : (time - before.hour) / span;

  // Рассвет в 6:00, закат в 19:00 (§3 ТЗ): между ними солнце описывает дугу над островом.
  const arc = ((time - 6) / 13) * Math.PI;

  return {
    sunDirection: new THREE.Vector3(
      Math.cos(arc) * Math.cos(SUN_PLANE),
      Math.sin(arc),
      Math.cos(arc) * Math.sin(SUN_PLANE),
    ).normalize(),
    sunColor: new THREE.Color(before.sun).lerp(new THREE.Color(after.sun), t),
    sunIntensity: before.sunIntensity + (after.sunIntensity - before.sunIntensity) * t,
    skyColor: new THREE.Color(before.sky).lerp(new THREE.Color(after.sky), t),
    groundColor: new THREE.Color(before.ground).lerp(new THREE.Color(after.ground), t),
    hemisphereIntensity: before.hemisphere + (after.hemisphere - before.hemisphere) * t,
    fogColor: new THREE.Color(before.fog).lerp(new THREE.Color(after.fog), t),
  };
}

/** Половина стороны области, попадающей в карту теней. */
const SHADOW_EXTENT = 46;

export class Lighting {
  readonly sun: THREE.DirectionalLight;
  readonly hemisphere: THREE.HemisphereLight;

  constructor(private readonly scene: THREE.Scene) {
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 260;
    this.sun.shadow.camera.left = -SHADOW_EXTENT;
    this.sun.shadow.camera.right = SHADOW_EXTENT;
    this.sun.shadow.camera.top = SHADOW_EXTENT;
    this.sun.shadow.camera.bottom = -SHADOW_EXTENT;
    // Сдвиг убирает муар на пологих поверхностях: воксели плоские и ловят его охотно.
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;

    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemisphere = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.6);
    scene.add(this.hemisphere);

    // Туман смыкает открытое море с небом: остров стоит в дымке, а не на плоской заготовке.
    scene.fog = new THREE.Fog(0x000000, 70, 210);
  }

  /**
   * Обновляет свет под время суток; карта теней следует за точкой, на которую смотрит камера.
   * Возвращает состояние неба — его цвет нужен воде для бликов на гребнях.
   */
  update(hour: number, focus: THREE.Vector3): SkyState {
    const sky = skyAt(hour);

    this.sun.color.copy(sky.sunColor);
    this.sun.intensity = sky.sunIntensity;
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(sky.sunDirection, 120);

    this.hemisphere.color.copy(sky.skyColor);
    this.hemisphere.groundColor.copy(sky.groundColor);
    this.hemisphere.intensity = sky.hemisphereIntensity;

    this.scene.background = sky.skyColor;
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.copy(sky.fogColor);

    return sky;
  }
}
