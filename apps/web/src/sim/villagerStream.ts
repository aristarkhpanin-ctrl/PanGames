import type { Villager } from '@gavan/shared';

/**
 * Плавное движение жителей между серверными снимками (M5.5).
 *
 * Тик приходит раз в десять секунд, а кадров за это время шестьсот. Позиции по сети каждый
 * кадр не ходят и ходить не должны — это тысячекратный трафик ради того, что клиент считает
 * интерполяцией сам (§9 ТЗ).
 *
 * Считает время между пришедшими снимками, а не доверяет расписанию: сеть задерживает
 * тик, и подстроиться под неё честнее, чем дёргать людей.
 */

/** Ожидаемый промежуток между тиками. Пока снимков меньше двух, идём по нему. */
const EXPECTED_GAP_SECONDS = 10;

export class VillagerStream {
  private previousSnapshot: Villager[] = [];
  private currentSnapshot: Villager[] = [];
  private sinceSnapshot = 0;
  private gapSeconds = EXPECTED_GAP_SECONDS;

  accept(villagers: Villager[]): void {
    this.previousSnapshot = this.currentSnapshot.length > 0 ? this.currentSnapshot : villagers;
    this.currentSnapshot = villagers;
    // Сеть дышит неровно; следующий отрезок растягиваем по тому, сколько шёл прошлый.
    if (this.sinceSnapshot > 0) this.gapSeconds = clampGap(this.sinceSnapshot);
    this.sinceSnapshot = 0;
  }

  /** Двигает время. Возвращает долю пути между снимками — по ней идёт сглаживание. */
  update(deltaSeconds: number): number {
    this.sinceSnapshot += deltaSeconds;
    return Math.min(this.sinceSnapshot / this.gapSeconds, 1);
  }

  get villagers(): readonly Villager[] {
    return this.currentSnapshot;
  }

  get previousVillagers(): readonly Villager[] {
    return this.previousSnapshot;
  }
}

/** Промежуток держим в разумных рамках: одна пропавшая пачка не должна замедлить людей вдвое. */
function clampGap(seconds: number): number {
  return Math.min(Math.max(seconds, 2), 20);
}
