import {
  ACCEPTED,
  MAX_TERRAFORM_EDITS,
  reject,
  type Command,
  type ValidationResult,
} from '../commands';
import { plantKind } from '../content/plants';
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
    default:
      // Остальные варианты появятся на M4 и M7. Форма контракта уже зафиксирована.
      return reject('not_implemented');
  }
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
