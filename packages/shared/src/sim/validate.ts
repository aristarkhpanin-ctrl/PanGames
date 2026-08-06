import {
  ACCEPTED,
  MAX_TERRAFORM_EDITS,
  reject,
  type Command,
  type ValidationResult,
} from '../commands';
import { buildingType, type BuildingType } from '../content/buildings';
import { plantKind } from '../content/plants';
import { canAfford, footprintOf, upgradeCost, type PlacedBuilding } from './economy';
import { FESTIVAL_COST } from './festival';
import { costInShells, hasHarbor, MAX_TRADE_AMOUNT, shellsForGiving, TRADABLE } from './trade';
import { isOpaque, Material, SEA_LEVEL, WORLD_X, WORLD_Y, WORLD_Z, columnIndex } from '../voxels';
import { isInside, surfaceHeight, type WorldReader, type WorldState } from './world';

/**
 * Проверка команд. Один и тот же код исполняется на клиенте (предсказание) и на сервере
 * (решение) — расхождение между ними означало бы, что игрок видит одно, а получает другое.
 *
 * Функция чистая: ни времени, ни случайности, ни обращений наружу.
 */

/** Чем можно засыпать и что можно копать. Кирпич и доски кладутся только зданиями. */
export const TERRAFORM_MATERIALS: readonly number[] = [
  Material.AIR,
  Material.DIRT,
  Material.SAND,
  Material.STONE,
  Material.GRASS,
  Material.PATH,
];

/** Самый нижний слой мира не трогаем: под ним пустота, и остров провалится. */
const BEDROCK = 1;

export function validate(
  command: Command,
  state: WorldState,
  world: WorldReader,
): ValidationResult {
  switch (command.t) {
    case 'terraform':
      return validateTerraform(command.edits, world);
    case 'plant':
      return validatePlant(command, state, world);
    case 'place_building':
      return validatePlacement(command.typeId, command.pos, command.rot, state, world, null);
    case 'move_building': {
      const existing = state.buildings.find((building) => building.id === command.id);
      if (existing === undefined) return reject('no_such_building');
      // Перемещение бесплатно и всегда (устав, п. 6) — цену не проверяем.
      return validatePlacement(
        existing.typeId,
        command.pos,
        command.rot,
        state,
        world,
        existing.id,
      );
    }
    case 'remove_building':
      return state.buildings.some((building) => building.id === command.id)
        ? ACCEPTED
        : reject('no_such_building');
    case 'upgrade_building': {
      const existing = state.buildings.find((building) => building.id === command.id);
      const type = existing === undefined ? undefined : buildingType(existing.typeId);
      if (existing === undefined || type === undefined) return reject('no_such_building');
      if (existing.progress < 1) return reject('still_building');
      if (existing.level >= 3) return reject('max_level');
      if (!canAfford(state.resources, upgradeCost(type, existing.level))) {
        return reject('cannot_afford');
      }
      return ACCEPTED;
    }
    case 'assign_job': {
      if (command.buildingId === null) return ACCEPTED;
      const target = state.buildings.find((building) => building.id === command.buildingId);
      const type = target === undefined ? undefined : buildingType(target.typeId);
      if (target === undefined || type === undefined) return reject('no_such_building');
      if (target.progress < 1) return reject('still_building');
      if (type.workers === 0) return reject('no_work_here');
      if (target.workers.length >= type.workers && !target.workers.includes(command.villagerId)) {
        return reject('crew_full');
      }
      return ACCEPTED;
    }
    case 'assign_home': {
      const target = state.buildings.find((building) => building.id === command.buildingId);
      const type = target === undefined ? undefined : buildingType(target.typeId);
      if (target === undefined || type === undefined) return reject('no_such_building');
      if (target.progress < 1) return reject('still_building');
      if ((type.beds ?? 0) === 0) return reject('no_beds');
      if (
        target.residents.length >= (type.beds ?? 0) &&
        !target.residents.includes(command.villagerId)
      ) {
        return reject('home_full');
      }
      return ACCEPTED;
    }
    case 'host_festival': {
      // Праздник — не покупка: он стоит еды и хорошего настроения, а не денег.
      const ready = state.buildings.some(
        (building) => building.typeId === 'firepit' && building.progress >= 1,
      );
      if (!ready) return reject('needs_firepit');
      if (!canAfford(state.resources, FESTIVAL_COST)) return reject('cannot_afford');
      return ACCEPTED;
    }
    case 'trade':
      return validateTrade(command, state);
    default:
      // `rename` появится вместе с интерфейсом переименования. Форма контракта уже есть.
      return reject('not_implemented');
  }
}

/**
 * Обмен у лодки (§4 ТЗ).
 *
 * Курс один и тот же всегда: спекулировать не на чем, дефицита не бывает. Лодка нужна ровно
 * затем, чтобы у игрока не кончился камень насовсем.
 */
function validateTrade(
  command: Extract<Command, { t: 'trade' }>,
  state: WorldState,
): ValidationResult {
  if (!hasHarbor(state.buildings)) return reject('needs_harbor');
  if (command.give === undefined && command.take === undefined) return reject('empty_command');

  if (command.give !== undefined) {
    if (!TRADABLE.includes(command.give.id)) return reject('not_tradable');
    if (command.give.amount <= 0 || command.give.amount > MAX_TRADE_AMOUNT) {
      return reject('too_much');
    }
    if (state.resources[command.give.id] < command.give.amount) return reject('cannot_afford');
  }

  if (command.take !== undefined) {
    if (!TRADABLE.includes(command.take.id)) return reject('not_tradable');
    if (command.take.amount <= 0 || command.take.amount > MAX_TRADE_AMOUNT) {
      return reject('too_much');
    }

    // Ракушки считаются с учётом того, что даём в этой же сделке: сдал камень — купил доски.
    const earned = command.give === undefined ? 0 : shellsForGiving(command.give.amount);
    const price = costInShells(command.take.id, command.take.amount);
    if (state.resources.shell + earned < price) return reject('cannot_afford');
  }

  return ACCEPTED;
}

function validateTerraform(
  edits: readonly { pos: { x: number; y: number; z: number }; mat: number }[],
  world: WorldReader,
): ValidationResult {
  if (edits.length === 0) return reject('empty_command');
  if (edits.length > MAX_TERRAFORM_EDITS) return reject('too_many_edits');

  for (const edit of edits) {
    if (!isInside(edit.pos)) return reject('outside_world');
    if (edit.pos.y < BEDROCK) return reject('bedrock');
    if (edit.pos.y >= WORLD_Y - 1) return reject('ceiling');
    if (!TERRAFORM_MATERIALS.includes(edit.mat)) return reject('material_not_allowed');

    const current = world.material(edit.pos.x, edit.pos.y, edit.pos.z);
    if (edit.mat === Material.AIR && !isOpaque(current)) return reject('nothing_to_dig');
  }

  if (wouldSplitIsland(edits, world)) return reject('would_split_island');

  return ACCEPTED;
}

/**
 * Остров обязан остаться одним куском: жители ходят пешком, и отрезанный клочок земли
 * означал бы место, куда никто не может дойти. Мосты появятся по главам и ставятся осознанно.
 *
 * Полный обход запускается только тогда, когда правка действительно превращает сушу в воду —
 * копать вершину холма можно сколько угодно, и платить за это обходом не нужно.
 */
function wouldSplitIsland(
  edits: readonly { pos: { x: number; y: number; z: number }; mat: number }[],
  world: WorldReader,
): boolean {
  const after = new Map<number, number>();
  for (const edit of edits) {
    after.set(edit.pos.x + WORLD_X * (edit.pos.z + WORLD_Z * edit.pos.y), edit.mat);
  }

  const materialAfter = (x: number, y: number, z: number): number =>
    after.get(x + WORLD_X * (z + WORLD_Z * y)) ?? world.material(x, y, z);

  const isLand = (
    x: number,
    z: number,
    read: (x: number, y: number, z: number) => number,
  ): boolean => {
    for (let y = WORLD_Y - 1; y > SEA_LEVEL; y -= 1) {
      if (isOpaque(read(x, y, z))) return true;
    }
    return false;
  };

  let anyColumnDrowned = false;
  const touched = new Set<number>();
  for (const edit of edits) touched.add(columnIndex(edit.pos.x, edit.pos.z));

  for (const column of touched) {
    const x = column % WORLD_X;
    const z = (column - x) / WORLD_X;
    if (isLand(x, z, world.material.bind(world)) && !isLand(x, z, materialAfter)) {
      anyColumnDrowned = true;
      break;
    }
  }

  if (!anyColumnDrowned) return false;

  // Суша ушла под воду хотя бы в одной клетке — теперь проверяем связность целиком.
  const land = new Uint8Array(WORLD_X * WORLD_Z);
  let total = 0;
  let start = -1;
  for (let z = 0; z < WORLD_Z; z += 1) {
    for (let x = 0; x < WORLD_X; x += 1) {
      if (!isLand(x, z, materialAfter)) continue;
      const index = columnIndex(x, z);
      land[index] = 1;
      total += 1;
      if (start === -1) start = index;
    }
  }

  if (total === 0) return true;

  const visited = new Uint8Array(land.length);
  const queue = new Int32Array(land.length);
  let head = 0;
  let tail = 0;
  queue[tail] = start;
  tail += 1;
  visited[start] = 1;
  let reached = 0;

  while (head < tail) {
    const current = queue[head] ?? 0;
    head += 1;
    reached += 1;
    const x = current % WORLD_X;

    const visit = (index: number): void => {
      if (land[index] === 1 && visited[index] === 0) {
        visited[index] = 1;
        queue[tail] = index;
        tail += 1;
      }
    };

    if (x > 0) visit(current - 1);
    if (x < WORLD_X - 1) visit(current + 1);
    if (current >= WORLD_X) visit(current - WORLD_X);
    if (current + WORLD_X < land.length) visit(current + WORLD_X);
  }

  return reached !== total;
}

function validatePlant(
  command: Extract<Command, { t: 'plant' }>,
  state: WorldState,
  world: WorldReader,
): ValidationResult {
  const kind = plantKind(command.kind);
  if (kind === undefined) return reject('unknown_plant');
  if (!isInside(command.pos)) return reject('outside_world');

  const { x, z } = command.pos;
  const surface = surfaceHeight(world, x, z, WORLD_Y - 1);
  if (surface < 0) return reject('bad_soil');
  if (surface <= SEA_LEVEL) return reject('underwater');

  const soil = world.material(x, surface, z);
  if (!kind.soil.includes(soil)) return reject('bad_soil');

  for (const plant of state.plants) {
    if (plant.x === x && plant.z === z) return reject('occupied');
    if (kind.spacing > 0 && Math.abs(plant.x - x) <= kind.spacing) {
      if (Math.abs(plant.z - z) <= kind.spacing) return reject('too_close');
    }
  }

  return ACCEPTED;
}

/**
 * Можно ли поставить здание сюда (§6 ТЗ).
 *
 * Проверяем всё сразу: помещается ли участок, ровная ли земля, не в воде ли, не пересекается
 * ли с соседями, открыто ли по цепочке и хватает ли ресурсов. Отказ возвращается кодом,
 * а интерфейс превращает его в объяснение, что делать дальше.
 */
function validatePlacement(
  typeId: string,
  pos: { x: number; y: number; z: number },
  rotation: 0 | 1 | 2 | 3,
  state: WorldState,
  world: WorldReader,
  ignoreBuildingId: string | null,
): ValidationResult {
  const type = buildingType(typeId);
  if (type === undefined) return reject('unknown_building');

  for (const required of type.requires) {
    const built = state.buildings.some(
      (building) => building.typeId === required && building.progress >= 1,
    );
    if (!built) return reject('requires_missing');
  }

  const { w, d } = footprintOf(type, rotation);
  if (pos.x < 0 || pos.z < 0 || pos.x + w > WORLD_X || pos.z + d > WORLD_Z) {
    return reject('outside_world');
  }

  const ground = groundCheck(type, pos, w, d, world);
  if (ground !== null) return reject(ground);

  if (overlaps(state.buildings, pos, w, d, ignoreBuildingId)) return reject('occupied');

  // Перемещение уже оплачено при заказе, а новая постройка — нет.
  if (ignoreBuildingId === null && !canAfford(state.resources, type.cost)) {
    return reject('cannot_afford');
  }

  // Вдохновение — валюта уюта (§4 ТЗ). Едой и досками за него не платят и не будут:
  // иначе оно превратится в обычный ресурс, который надо копить.
  if (
    (type.cost.inspiration ?? 0) > 0 &&
    type.category !== 'culture' &&
    type.category !== 'decor'
  ) {
    return reject('material_not_allowed');
  }

  return ACCEPTED;
}

/** Земля под участком: ровная суша, а для пирса и моста — мелководье. */
function groundCheck(
  type: BuildingType,
  pos: { x: number; y: number; z: number },
  w: number,
  d: number,
  world: WorldReader,
): 'uneven_ground' | 'needs_land' | 'needs_water' | null {
  let lowest = Infinity;
  let highest = -Infinity;

  for (let dz = 0; dz < d; dz += 1) {
    for (let dx = 0; dx < w; dx += 1) {
      const x = pos.x + dx;
      const z = pos.z + dz;
      const surface = surfaceHeight(world, x, z, WORLD_Y - 1);
      if (surface < 0) return 'needs_land';

      const underWater = surface <= SEA_LEVEL;
      if (type.overWater === true) {
        if (!underWater) return 'needs_water';
      } else if (underWater) {
        return 'needs_land';
      }

      lowest = Math.min(lowest, surface);
      highest = Math.max(highest, surface);
    }
  }

  // Перепад больше одного вокселя — здание повисло бы углом в воздухе.
  return highest - lowest > 1 ? 'uneven_ground' : null;
}

function overlaps(
  buildings: readonly PlacedBuilding[],
  pos: { x: number; z: number },
  w: number,
  d: number,
  ignoreId: string | null,
): boolean {
  for (const building of buildings) {
    if (building.id === ignoreId) continue;
    const type = buildingType(building.typeId);
    if (type === undefined) continue;
    const size = footprintOf(type, building.rotation);

    const apart =
      pos.x + w <= building.x ||
      building.x + size.w <= pos.x ||
      pos.z + d <= building.z ||
      building.z + size.d <= pos.z;
    if (!apart) return true;
  }
  return false;
}
