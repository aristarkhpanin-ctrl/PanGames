import { describe, expect, it } from 'vitest';

import { createNoise2D, createNoise3D, fbm2 } from './noise';
import { createRng } from './rng';

describe('шум Перлина', () => {
  it('воспроизводим до последнего знака', () => {
    // Клиент и сервер обязаны получить одинаковый остров из одинакового сида.
    const a = createNoise2D(createRng(7));
    const b = createNoise2D(createRng(7));
    for (let i = 0; i < 1000; i += 1) {
      const x = i * 0.137;
      const y = i * 0.211;
      expect(a(x, y)).toBe(b(x, y));
    }
  });

  it('совпадает с эталоном', () => {
    const noise = createNoise2D(createRng(7));
    const values = [
      [0.5, 0.5],
      [3.25, -1.75],
      [100.1, 42.9],
    ].map(([x, y]) => Number(noise(x ?? 0, y ?? 0).toFixed(12)));
    expect(values).toEqual([0.25, 0.057765557947, 0.012002043575]);
  });

  it('2D не выходит за [-1, 1] и при этом не задавлен', () => {
    const noise = createNoise2D(createRng(1));
    let max = 0;
    let sum = 0;
    let outOfRange = 0;
    const samples = 200_000;
    for (let i = 0; i < samples; i += 1) {
      const value = noise((i % 631) * 0.137 + 0.31, Math.floor(i / 631) * 0.211 + 0.17);
      if (value < -1 || value > 1) outOfRange += 1;
      max = Math.max(max, Math.abs(value));
      sum += value;
    }
    expect(outOfRange).toBe(0);
    // Если бы нормировка была слишком сильной, остров вышел бы плоским.
    expect(max).toBeGreaterThan(0.9);
    expect(sum / samples).toBeCloseTo(0, 2);
  });

  it('3D не выходит за [-1, 1] и при этом не задавлен', () => {
    const noise = createNoise3D(createRng(1));
    let max = 0;
    let outOfRange = 0;
    for (let i = 0; i < 200_000; i += 1) {
      const value = noise((i % 631) * 0.137 + 0.31, Math.floor(i / 631) * 0.211 + 0.17, i * 0.037);
      if (value < -1 || value > 1) outOfRange += 1;
      max = Math.max(max, Math.abs(value));
    }
    expect(outOfRange).toBe(0);
    expect(max).toBeGreaterThan(0.9);
  });

  it('обращается в ноль в целочисленных узлах решётки', () => {
    // Свойство самого алгоритма Перлина. Записано тестом, чтобы про него помнили:
    // выборка строго по целым координатам дала бы ровный ноль вместо рельефа.
    const noise = createNoise2D(createRng(4));
    for (let i = 0; i < 50; i += 1) {
      expect(noise(i, i * 2)).toBeCloseTo(0, 12);
    }
  });

  it('непрерывен: соседние точки не прыгают', () => {
    // Разрыв в шуме дал бы обрыв рельефа посреди луга.
    const noise = createNoise2D(createRng(3));
    let maxJump = 0;
    for (let i = 0; i < 20_000; i += 1) {
      const x = i * 0.01;
      const y = 12.34;
      maxJump = Math.max(maxJump, Math.abs(noise(x, y) - noise(x + 0.001, y)));
    }
    expect(maxJump).toBeLessThan(0.02);
  });

  it('разные сиды дают разный рельеф', () => {
    const a = createNoise2D(createRng(1));
    const b = createNoise2D(createRng(2));
    let differences = 0;
    for (let i = 0; i < 1000; i += 1) {
      // Смещение уводит выборку с узлов решётки, где любой шум Перлина равен нулю.
      const x = i * 0.3 + 0.13;
      const y = i * 0.7 + 0.37;
      if (Math.abs(a(x, y) - b(x, y)) > 1e-9) differences += 1;
    }
    expect(differences).toBeGreaterThan(990);
  });
});

describe('fbm2', () => {
  it('остаётся в [-1, 1] на любом числе октав', () => {
    const noise = createNoise2D(createRng(21));
    let outOfRange = 0;
    for (const octaves of [1, 2, 3, 4, 6, 8]) {
      for (let i = 0; i < 20_000; i += 1) {
        const value = fbm2(noise, (i % 311) * 0.09, Math.floor(i / 311) * 0.07, { octaves });
        if (value < -1 || value > 1) outOfRange += 1;
      }
    }
    expect(outOfRange).toBe(0);
  });

  it('воспроизводим', () => {
    const a = createNoise2D(createRng(5));
    const b = createNoise2D(createRng(5));
    expect(fbm2(a, 1.5, 2.5, { octaves: 4 })).toBe(fbm2(b, 1.5, 2.5, { octaves: 4 }));
  });

  it('добавляет детали с ростом числа октав', () => {
    // Считаем локальные экстремумы вдоль линии: чем больше октав, тем чаще рельеф
    // меняет направление. Суммарный размах для этого не годится — fbm нормирован,
    // и добавление октав его как раз уменьшает.
    const noise = createNoise2D(createRng(9));
    const turningPoints = (octaves: number): number => {
      let count = 0;
      let previousSlope = 0;
      let previous = fbm2(noise, 0.13, 3.3, { octaves });
      for (let i = 1; i < 4000; i += 1) {
        const value = fbm2(noise, i * 0.01 + 0.13, 3.3, { octaves });
        const slope = Math.sign(value - previous);
        if (slope !== 0 && previousSlope !== 0 && slope !== previousSlope) count += 1;
        if (slope !== 0) previousSlope = slope;
        previous = value;
      }
      return count;
    };
    expect(turningPoints(4)).toBeGreaterThan(turningPoints(1) * 1.5);
  });

  it('нулевое число октав не роняет расчёт', () => {
    const noise = createNoise2D(createRng(1));
    expect(fbm2(noise, 1, 1, { octaves: 0 })).toBe(0);
  });
});
