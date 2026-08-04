/**
 * Игровое время (§3 ТЗ). Час — минута реального времени, сутки — 24 минуты,
 * тик симуляции — 10 реальных секунд, то есть 10 игровых минут; 144 тика в сутках.
 *
 * Само время сюда приходит числом: ядро симуляции не имеет права спросить, который час.
 */

export const REAL_SECONDS_PER_GAME_HOUR = 60;
export const GAME_MINUTES_PER_TICK = 10;
export const TICKS_PER_HOUR = 60 / GAME_MINUTES_PER_TICK;
export const TICKS_PER_DAY = TICKS_PER_HOUR * 24;

/** Рассвет и закат (§3 ТЗ). Ночью жители спят, а производство идёт на 30%. */
export const DAWN_HOUR = 6;
export const DUSK_HOUR = 19;

export function hourOfTick(tick: number): number {
  return ((tick % TICKS_PER_DAY) * GAME_MINUTES_PER_TICK) / 60;
}

export function dayOfTick(tick: number): number {
  return Math.floor(tick / TICKS_PER_DAY);
}

export function isDaylight(hour: number): boolean {
  return hour >= DAWN_HOUR && hour < DUSK_HOUR;
}

/** Множитель производства по времени суток (§4 ТЗ). */
export function timeOfDayFactor(hour: number): number {
  return isDaylight(hour) ? 1 : 0.3;
}

/** Человеческое время для интерфейса: «7:20». Часы без ведущего нуля, как на вывеске. */
export function formatHour(hour: number): string {
  const whole = Math.floor(hour) % 24;
  const minutes = Math.floor((hour - Math.floor(hour)) * 60);
  return `${String(whole)}:${String(minutes).padStart(2, '0')}`;
}

/** Часть суток словом — для строки «сейчас» в карточке жителя. */
export function partOfDay(hour: number): string {
  if (hour < 5) return 'глубокой ночью';
  if (hour < 9) return 'утром';
  if (hour < 12) return 'до полудня';
  if (hour < 17) return 'днём';
  if (hour < 20) return 'вечером';
  return 'ночью';
}
