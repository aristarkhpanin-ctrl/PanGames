import { Palette, SEA_LEVEL, VOXEL_SIZE, WORLD_X, WORLD_Z, columnIndex } from '@gavan/shared';
import * as THREE from 'three';

import type { SkyState } from './lighting';

/**
 * Вода — отдельный полупрозрачный слой поверх дна (§2.5 ТЗ), а не воксели чанка.
 * Лёгкая синусоида по вершинам и градиент по глубине; никакого отражения экранного
 * пространства — оно дорогое и чужое этому стилю.
 */

/** Шаг сетки воды в вокселях. Два — компромисс между плавностью волны и числом треугольников. */
const GRID_STEP = 2;

/** Поверхность воды стоит вровень с верхом вокселя уровня моря. */
const SURFACE_Y = (SEA_LEVEL + 1) * VOXEL_SIZE;

/** Насколько открытое море уходит за край мира, в метрах. */
const HORIZON_REACH = 260;

/**
 * Свой шейдер обязан сам применить тональную компрессию, перевод в цветовое пространство
 * вывода и туман — три.js подставляет это только в свои материалы. Без них вода светилась
 * иначе, чем всё остальное, и на границе с открытым морем была видна ровная линия.
 */
const vertexShader = /* glsl */ `
  #include <fog_pars_vertex>

  attribute float depth;
  varying float vDepth;
  varying float vCrest;
  uniform float uTime;

  void main() {
    vDepth = depth;

    // На мелководье волна гаснет, иначе она вылезает на песок.
    float damping = clamp(depth / 3.0, 0.0, 1.0);
    float wave =
      sin(position.x * 0.55 + uTime * 0.9) * 0.05 +
      sin(position.z * 0.41 - uTime * 0.7) * 0.04 +
      sin((position.x + position.z) * 0.23 + uTime * 0.5) * 0.03;

    vCrest = wave;
    vec3 transformed = position + vec3(0.0, wave * damping, 0.0);
    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>

  varying float vDepth;
  varying float vCrest;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uSky;
  uniform float uLight;

  void main() {
    float t = smoothstep(0.0, 9.0, vDepth);
    vec3 color = mix(uShallow, uDeep, t);

    // Гребни ловят цвет неба — этого хватает, чтобы вода читалась как вода.
    color += uSky * clamp(vCrest * 2.2, 0.0, 1.0) * 0.18;

    // Вода не освещается движком, поэтому уровень света приходит числом: иначе на закате
    // остров темнеет, а море остаётся полуденно-бирюзовым.
    color *= uLight;

    // У берега вода прозрачнее: сквозь неё видно песок.
    float alpha = mix(0.55, 0.93, t);
    gl_FragColor = vec4(color, alpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export class Water {
  /** Волнующаяся вода над островом и плоское море до горизонта. */
  readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;
  private readonly ocean: THREE.Mesh;
  private readonly oceanMaterial: THREE.MeshBasicMaterial;
  private readonly waves: THREE.Mesh;

  // Значения держим по ссылке: обращение к uniforms по строковому ключу даёт
  // «возможно undefined» на каждом кадре, а приведение типов здесь ничего не проверяет.
  private readonly uTime = { value: 0 };
  private readonly uLight = { value: 1 };
  private readonly uSky = { value: new THREE.Color(0xffffff) };

  private elapsed = 0;

  constructor(waterDepth: Uint8Array) {
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: this.uTime,
        uLight: this.uLight,
        uSky: this.uSky,
        uShallow: { value: new THREE.Color(Palette.seaShallow) },
        uDeep: { value: new THREE.Color(Palette.seaDeep) },
      },
    });

    this.waves = new THREE.Mesh(buildGeometry(waterDepth), this.material);
    this.waves.renderOrder = 1;
    // Вода не отбрасывает и не принимает тень: у полупрозрачного слоя это выглядит грязью.
    this.waves.castShadow = false;
    this.waves.receiveShadow = false;

    this.oceanMaterial = new THREE.MeshBasicMaterial({ color: Palette.seaDeep });
    this.ocean = buildOceanRing(this.oceanMaterial);
    this.group.add(this.ocean, this.waves);
  }

  update(deltaSeconds: number, sky: SkyState): void {
    this.elapsed += deltaSeconds;

    // Полдень принят за единицу; ниже 0.2 не опускаемся, иначе ночью вода становится дырой.
    const light = THREE.MathUtils.clamp(
      (sky.hemisphereIntensity + sky.sunIntensity * 0.5) / 1.48,
      0.2,
      1,
    );

    this.uTime.value = this.elapsed;
    this.uSky.value.copy(sky.skyColor);
    this.uLight.value = light;

    this.oceanMaterial.color.setHex(Palette.seaDeep).multiplyScalar(light);
  }

  dispose(): void {
    this.waves.geometry.dispose();
    this.ocean.geometry.dispose();
    this.material.dispose();
    this.oceanMaterial.dispose();
  }
}

/**
 * Открытое море до горизонта — рамкой вокруг мира, а не сплошной плитой.
 *
 * Сплошная плита закрыла бы дно у берега, а без моря вообще у края мира торчало ребро воды,
 * которое видно с любой камеры. Рамка из четырёх прямоугольников стоит восемь треугольников.
 */
function buildOceanRing(material: THREE.MeshBasicMaterial): THREE.Mesh {
  const width = WORLD_X * VOXEL_SIZE;
  const depth = WORLD_Z * VOXEL_SIZE;
  const outer = HORIZON_REACH;

  const positions: number[] = [];
  const indices: number[] = [];

  const quad = (x0: number, z0: number, x1: number, z1: number): void => {
    const base = positions.length / 3;
    positions.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1);
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };

  // Кольцо заходит под волнующуюся воду на несколько метров: иначе на стыке видна полоска,
  // потому что у самой границы волна поднимает вершины, а плоское море стоит неподвижно.
  const overlap = 4;
  quad(-outer, -outer, width + outer, overlap);
  quad(-outer, depth - overlap, width + outer, depth + outer);
  quad(-outer, 0, overlap, depth);
  quad(width - overlap, 0, width + outer, depth);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, material);
  // Чуть ниже волнующейся воды, чтобы на стыке не было мерцания.
  mesh.position.y = SURFACE_Y - 0.02;
  return mesh;
}

function buildGeometry(waterDepth: Uint8Array): THREE.BufferGeometry {
  const cellsX = WORLD_X / GRID_STEP;
  const cellsZ = WORLD_Z / GRID_STEP;
  const verticesX = cellsX + 1;

  const positions: number[] = [];
  const depths: number[] = [];

  for (let gz = 0; gz <= cellsZ; gz += 1) {
    for (let gx = 0; gx <= cellsX; gx += 1) {
      const vx = Math.min(gx * GRID_STEP, WORLD_X - 1);
      const vz = Math.min(gz * GRID_STEP, WORLD_Z - 1);
      positions.push(gx * GRID_STEP * VOXEL_SIZE, SURFACE_Y, gz * GRID_STEP * VOXEL_SIZE);
      depths.push(waterDepth[columnIndex(vx, vz)] ?? 0);
    }
  }

  const indices: number[] = [];
  for (let gz = 0; gz < cellsZ; gz += 1) {
    for (let gx = 0; gx < cellsX; gx += 1) {
      const a = gx + gz * verticesX;
      const b = a + 1;
      const c = a + verticesX;
      const d = c + 1;

      // Клетка рисуется, только если под каким-нибудь из четырёх углов есть вода: над сушей
      // полупрозрачный слой давал бы мутную плёнку поверх травы.
      if (
        (depths[a] ?? 0) === 0 &&
        (depths[b] ?? 0) === 0 &&
        (depths[c] ?? 0) === 0 &&
        (depths[d] ?? 0) === 0
      ) {
        continue;
      }

      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('depth', new THREE.Float32BufferAttribute(depths, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
