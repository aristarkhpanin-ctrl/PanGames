/** Мелкая математика, нужная и генератору мира, и симуляции. Всё чистое и без состояния. */

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Плавный переход от 0 к 1 на отрезке [edge0, edge1], с нулевой производной на концах. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Угловое расстояние между направлениями, всегда в [0, π]. */
export function angleDistance(a: number, b: number): number {
  const difference = Math.abs(a - b) % (Math.PI * 2);
  return difference > Math.PI ? Math.PI * 2 - difference : difference;
}

export function distance2D(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}
