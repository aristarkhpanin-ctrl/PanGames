import { BUILDINGS, type PlacedBuilding, type ResourceId } from '@gavan/shared';

/**
 * Ресурсы человеческим языком (§8 ТЗ).
 *
 * Интерфейс не показывает кодов и не говорит «недостаточно ресурсов»: он называет вещи
 * своими именами и объясняет, что делать дальше. Поэтому склонения живут здесь, а не
 * складываются из строк по месту.
 */

/** Три формы: «1 доска», «2 доски», «6 досок». */
type Forms = readonly [string, string, string];

const FORMS: Readonly<Record<ResourceId, Forms>> = {
  wood: ['бревно', 'бревна', 'брёвен'],
  stone: ['камень', 'камня', 'камней'],
  clay: ['глина', 'глины', 'глины'],
  sand: ['песок', 'песка', 'песка'],
  fiber: ['волокно', 'волокна', 'волокон'],
  fish: ['рыба', 'рыбы', 'рыб'],
  fruit: ['фрукт', 'фрукта', 'фруктов'],
  grain: ['зерно', 'зерна', 'зерна'],
  wool: ['шерсть', 'шерсти', 'шерсти'],
  plank: ['доска', 'доски', 'досок'],
  brick: ['кирпич', 'кирпича', 'кирпичей'],
  glass: ['стекло', 'стекла', 'стёкол'],
  cloth: ['ткань', 'ткани', 'ткани'],
  bread: ['хлеб', 'хлеба', 'хлеба'],
  tool: ['инструмент', 'инструмента', 'инструментов'],
  meal: ['обед', 'обеда', 'обедов'],
  shell: ['ракушка', 'ракушки', 'ракушек'],
  inspiration: ['вдохновение', 'вдохновения', 'вдохновения'],
};

/** Как ресурс подписан в счётчике: коротко и в именительном падеже. */
export const RESOURCE_LABEL: Readonly<Record<ResourceId, string>> = {
  wood: 'дерево',
  stone: 'камень',
  clay: 'глина',
  sand: 'песок',
  fiber: 'волокно',
  fish: 'рыба',
  fruit: 'фрукты',
  grain: 'зерно',
  wool: 'шерсть',
  plank: 'доски',
  brick: 'кирпич',
  glass: 'стекло',
  cloth: 'ткань',
  bread: 'хлеб',
  tool: 'инструменты',
  meal: 'обеды',
  shell: 'ракушки',
  inspiration: 'вдохновение',
};

/** Четыре счётчика, которые видны всегда (§8 ТЗ). Остальное раскрывается по клику. */
export const KEY_RESOURCES: readonly ResourceId[] = ['wood', 'stone', 'plank', 'fruit'];

export function pluralForm(count: number, forms: Forms): string {
  const whole = Math.abs(Math.floor(count));
  const tens = whole % 100;
  if (tens >= 11 && tens <= 14) return forms[2];

  const ones = whole % 10;
  if (ones === 1) return forms[0];
  if (ones >= 2 && ones <= 4) return forms[1];
  return forms[2];
}

/** «6 досок», «1 бревно». */
export function amountText(id: ResourceId, count: number): string {
  const whole = Math.floor(count);
  return `${String(whole)} ${pluralForm(whole, FORMS[id])}`;
}

/** Перечисление через запятую: «6 досок и 2 камня». */
export function listText(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} и ${String(parts[parts.length - 1])}`;
}

/**
 * Чего не хватает и откуда это возьмётся.
 *
 * Здание-производитель находится по каталогу, а не по списку в коде: новое здание
 * начинает подсказывать о себе само.
 */
export function shortageText(
  missing: Partial<Record<ResourceId, number>>,
  buildings: readonly PlacedBuilding[],
): string {
  const entries = Object.entries(missing) as [ResourceId, number][];
  if (entries.length === 0) return '';

  const parts = entries.map(([id, amount]) => amountText(id, amount));
  const first = entries[0];
  const hint = first === undefined ? '' : sourceHint(first[0], buildings);

  return `Не хватает ${listText(parts)}.${hint === '' ? '' : ` ${hint}`}`;
}

function sourceHint(id: ResourceId, buildings: readonly PlacedBuilding[]): string {
  const maker = BUILDINGS.find((type) => type.output?.[id] !== undefined);
  if (maker === undefined) return '';

  const built = buildings.some((building) => building.typeId === maker.id);
  const what = RESOURCE_LABEL[id];

  return built
    ? `${maker.name} сделает ещё к вечеру.`
    : `${what.charAt(0).toUpperCase()}${what.slice(1)} делает ${maker.name.toLowerCase()}.`;
}

/** Причина простоя — строчкой, а не значком тревоги (устав, п. 8). */
export const PAUSE_TEXT: Readonly<Record<string, string>> = {
  no_worker: 'Здесь пока некому работать',
  no_input: 'Кончилось сырьё, ждём подвоза',
  storage_full: 'Склад полон, работа подождёт',
  no_source: 'Залежь рядом опустела, можно перенести ближе к новой',
};
