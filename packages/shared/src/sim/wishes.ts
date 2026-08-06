import { buildingType } from '../content/buildings';
import { distance2D } from '../math';
import type { Vec3, Villager, Wish, WishKind } from '../types';
import type { PlacedBuilding } from './economy';

/**
 * Желания вместо квестов (§7 ТЗ).
 *
 * Желание — это просьба человека, а не задание. У него нет срока, нет провала и нет
 * напоминаний: не выполнил — не происходит ровно ничего. Это правило записано здесь кодом,
 * а не в тексте интерфейса, потому что иначе оно рано или поздно нарушится.
 *
 * Желание живёт в дневнике и в карточке жителя. Списка задач, прогресса и значка на иконке
 * нет и не будет — они превращают заботу в работу.
 */

/** Больше одного желания на жителя не бывает: очередь просьб — это уже список задач. */
export const WISHES_PER_VILLAGER = 1;

/** Потолок на остров. Иначе дневник превращается в доску объявлений. */
export const WISHES_PER_ISLAND = 4;

/** Насколько близко должно быть исполнение, чтобы считаться исполнением. */
const NEARBY = 8;

/** Ниже какого уровня нужда начинает мечтать вслух. */
const WISHING_NEED = 55;

export interface WishContext {
  villagers: readonly Villager[];
  buildings: readonly PlacedBuilding[];
  /** Достаточно координат: желанию всё равно, что именно растёт рядом. */
  plants: readonly { x: number; z: number }[];
  tick: number;
}

/** Что именно просит житель — данные, слова подберёт интерфейс. */
export interface WishDescription {
  kind: WishKind;
  /** Что построить или посадить: идентификатор из каталога. */
  wants: string;
  /** Где хочется. Пусто — где угодно на острове. */
  where?: Vec3;
}

/**
 * Рождение желания: незакрытая нужда плюс характер плюс место.
 *
 * Возвращает `null`, когда просить нечего или уже просил: желание появляется само и редко,
 * а не выдаётся по расписанию.
 */
export function wishFor(villager: Villager, context: WishContext): Wish | null {
  if (villager.wish !== undefined) return null;

  const description = describeWish(villager, context);
  if (description === null) return null;

  const wish: Wish = { kind: description.kind, createdAt: context.tick };
  return wish;
}

/** Чего именно хочется. Отделено от самого желания: интерфейсу нужны подробности. */
export function describeWish(villager: Villager, context: WishContext): WishDescription | null {
  const spot = villager.favoriteSpot;

  // Скамейка на любимом месте — самое сильное желание в игре: игрок видит, где человек
  // проводит время, и ставит скамейку туда сам (§5 ТЗ).
  if (spot !== undefined && !hasBuildingNear(context.buildings, spot, 'bench')) {
    return { kind: 'bench_at_favorite_spot', wants: 'bench', where: spot };
  }

  if (villager.needs.beauty < WISHING_NEED && !hasPlantNear(context.plants, villager.position)) {
    return { kind: 'plant_nearby', wants: 'flower', where: villager.position };
  }

  if (
    villager.needs.social < WISHING_NEED &&
    !hasGatheringPlaceNear(context.buildings, villager.position)
  ) {
    return { kind: 'building_nearby', wants: 'firepit', where: villager.position };
  }

  if (
    villager.needs.rest < WISHING_NEED &&
    !hasBuildingNear(context.buildings, villager.position, 'lamp')
  ) {
    return { kind: 'more_light', wants: 'lamp', where: villager.position };
  }

  return null;
}

/**
 * Сбылось ли желание.
 *
 * Проверяется при изменении мира, а не постоянным опросом: игрок что-то поставил — самое
 * время посмотреть, не про это ли кто-то думал.
 */
export function wishFulfilled(villager: Villager, context: WishContext): boolean {
  if (villager.wish === undefined) return false;

  const spot = villager.favoriteSpot ?? villager.position;

  switch (villager.wish.kind) {
    case 'bench_at_favorite_spot':
      return hasBuildingNear(context.buildings, spot, 'bench');
    case 'plant_nearby':
      return hasPlantNear(context.plants, spot);
    case 'building_nearby':
      return hasGatheringPlaceNear(context.buildings, spot);
    case 'more_light':
      return hasBuildingNear(context.buildings, spot, 'lamp');
    default:
      return false;
  }
}

/** Сколько желаний сейчас загадано на острове. */
export function activeWishes(villagers: readonly Villager[]): number {
  return villagers.filter((villager) => villager.wish !== undefined).length;
}

function hasBuildingNear(
  buildings: readonly PlacedBuilding[],
  where: Vec3,
  typeId: string,
): boolean {
  return buildings.some(
    (building) =>
      building.typeId === typeId &&
      building.progress >= 1 &&
      distance2D(building.x, building.z, where.x, where.z) <= NEARBY,
  );
}

/** Где можно собраться: костровище или что угодно из культуры — скамейка тоже годится. */
function hasGatheringPlaceNear(buildings: readonly PlacedBuilding[], where: Vec3): boolean {
  return buildings.some((building) => {
    if (building.progress < 1) return false;

    const type = buildingType(building.typeId);
    if (type === undefined) return false;
    if (type.id !== 'firepit' && type.category !== 'culture') return false;

    return distance2D(building.x, building.z, where.x, where.z) <= NEARBY;
  });
}

function hasPlantNear(plants: readonly { x: number; z: number }[], where: Vec3): boolean {
  return plants.some((plant) => distance2D(plant.x, plant.z, where.x, where.z) <= NEARBY);
}
