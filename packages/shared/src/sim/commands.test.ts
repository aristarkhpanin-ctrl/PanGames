import { beforeEach, describe, expect, it } from 'vitest';

import { MAX_TERRAFORM_EDITS, type Command } from '../commands';
import { Material, SEA_LEVEL, voxelIndex, WORLD_VOXEL_COUNT, WORLD_X, WORLD_Y } from '../voxels';
import { generateIsland } from '../worldgen/island';
import { applyCommand } from './apply';
import { validate } from './validate';
import {
  commitEffect,
  createWorldState,
  dirtyChunks,
  fromWorldPatches,
  invertEffect,
  surfaceHeight,
  toWorldPatches,
  type WorldReader,
  type WorldState,
} from './world';

const SEED = 42;
const island = generateIsland(SEED);

/** Живой мир: генерация плюс уже применённые правки. Так же устроен клиент. */
function createWorld(): { reader: WorldReader; voxels: Uint8Array } {
  const voxels = island.voxels.slice();
  return {
    voxels,
    reader: {
      material: (x, y, z) => voxels[voxelIndex(x, y, z)] ?? Material.AIR,
    },
  };
}

/** Клетка суши подальше от берега, чтобы правки не задевали связность острова. */
function findInlandColumn(): { x: number; z: number; surface: number } {
  for (let z = 20; z < 140; z += 1) {
    for (let x = 20; x < 140; x += 1) {
      const column = x + WORLD_X * z;
      if (island.shape.land[column] !== 1) continue;
      if ((island.shape.distToWater[column] ?? 0) < 12) continue;
      return { x, z, surface: island.surfaceY[column] ?? 0 };
    }
  }
  throw new Error('на острове не нашлось клетки вдали от воды');
}

const inland = findInlandColumn();

describe('слой команд — терраформирование', () => {
  let state: WorldState;
  let world: ReturnType<typeof createWorld>;

  beforeEach(() => {
    state = createWorldState(SEED);
    world = createWorld();
  });

  const dig: Command = {
    t: 'terraform',
    edits: [{ pos: { x: inland.x, y: inland.surface, z: inland.z }, mat: Material.AIR }],
  };

  it('принимает обычный подкоп', () => {
    expect(validate(dig, state, world.reader)).toEqual({ ok: true });
  });

  it('применение не трогает исходное состояние', () => {
    // Решение принимает validate, а apply только считает разницу: мутировать он не вправе.
    applyCommand(dig, state, world.reader);
    expect(state.edits.size).toBe(0);
    expect(state.plants).toHaveLength(0);
  });

  it('отказ не меняет мир', () => {
    const bad: Command = {
      t: 'terraform',
      edits: [{ pos: { x: inland.x, y: 0, z: inland.z }, mat: Material.AIR }],
    };
    expect(validate(bad, state, world.reader)).toEqual({ ok: false, reason: 'bedrock' });
    expect(state.edits.size).toBe(0);
  });

  it('не даёт копать пустоту', () => {
    const air: Command = {
      t: 'terraform',
      edits: [{ pos: { x: inland.x, y: inland.surface + 4, z: inland.z }, mat: Material.AIR }],
    };
    expect(validate(air, state, world.reader)).toEqual({ ok: false, reason: 'nothing_to_dig' });
  });

  it('держит лимит правок за команду', () => {
    const edits = Array.from({ length: MAX_TERRAFORM_EDITS + 1 }, (_, i) => ({
      pos: { x: inland.x, y: inland.surface, z: inland.z + (i % 5) },
      mat: Material.AIR,
    }));
    expect(validate({ t: 'terraform', edits }, state, world.reader)).toEqual({
      ok: false,
      reason: 'too_many_edits',
    });
  });

  it('не пускает за пределы мира и выше потолка', () => {
    expect(
      validate(
        { t: 'terraform', edits: [{ pos: { x: -1, y: 40, z: 5 }, mat: Material.DIRT }] },
        state,
        world.reader,
      ),
    ).toEqual({ ok: false, reason: 'outside_world' });

    expect(
      validate(
        {
          t: 'terraform',
          edits: [{ pos: { x: inland.x, y: WORLD_Y - 1, z: inland.z }, mat: Material.DIRT }],
        },
        state,
        world.reader,
      ),
    ).toEqual({ ok: false, reason: 'ceiling' });
  });

  it('не даёт класть материалы, которые ставятся только зданиями', () => {
    expect(
      validate(
        {
          t: 'terraform',
          edits: [
            { pos: { x: inland.x, y: inland.surface + 1, z: inland.z }, mat: Material.BRICK },
          ],
        },
        state,
        world.reader,
      ),
    ).toEqual({ ok: false, reason: 'material_not_allowed' });
  });

  it('запрещает разрезать остров надвое', () => {
    // Настоящий остров редко имеет перешеек ровно в одну клетку, поэтому берём
    // выдуманный мир: два массива суши, соединённые мостиком шириной в клетку.
    const voxels = new Uint8Array(WORLD_VOXEL_COUNT);
    const put = (x: number, z: number): void => {
      voxels[voxelIndex(x, SEA_LEVEL + 1, z)] = Material.STONE;
    };
    for (let z = 20; z < 40; z += 1) {
      for (let x = 20; x < 40; x += 1) put(x, z);
      for (let x = 60; x < 80; x += 1) put(x, z);
    }
    for (let x = 40; x < 60; x += 1) put(x, 30);

    const reader = {
      material: (x: number, y: number, z: number) => voxels[voxelIndex(x, y, z)] ?? Material.AIR,
    };
    const bare = createWorldState(SEED);

    const cutBridge: Command = {
      t: 'terraform',
      edits: [{ pos: { x: 50, y: SEA_LEVEL + 1, z: 30 }, mat: Material.AIR }],
    };
    expect(validate(cutBridge, bare, reader)).toEqual({
      ok: false,
      reason: 'would_split_island',
    });

    // Контроль: та же по форме правка внутри массива суши проходит без возражений.
    const insideBlob: Command = {
      t: 'terraform',
      edits: [{ pos: { x: 25, y: SEA_LEVEL + 1, z: 25 }, mat: Material.AIR }],
    };
    expect(validate(insideBlob, bare, reader)).toEqual({ ok: true });
  });

  it('отмена возвращает мир в прежнее состояние', () => {
    const before = world.reader.material(inland.x, inland.surface, inland.z);

    const effect = applyCommand(dig, state, world.reader);
    commitEffect(state, effect);
    for (const change of effect.voxels) world.voxels[change.index] = change.material;
    expect(world.reader.material(inland.x, inland.surface, inland.z)).toBe(Material.AIR);

    const undo = invertEffect(effect);
    commitEffect(state, undo);
    for (const change of undo.voxels) world.voxels[change.index] = change.material;
    expect(world.reader.material(inland.x, inland.surface, inland.z)).toBe(before);
  });

  it('одна и та же последовательность даёт один результат', () => {
    const run = (): string => {
      const s = createWorldState(SEED);
      const w = createWorld();
      for (let i = 0; i < 5; i += 1) {
        const command: Command = {
          t: 'terraform',
          edits: [{ pos: { x: inland.x + i, y: inland.surface, z: inland.z }, mat: Material.AIR }],
        };
        if (!validate(command, s, w.reader).ok) continue;
        const effect = applyCommand(command, s, w.reader);
        commitEffect(s, effect);
        for (const change of effect.voxels) w.voxels[change.index] = change.material;
      }
      return JSON.stringify(toWorldPatches(s));
    };

    expect(run()).toBe(run());
  });
});

describe('слой команд — посадка', () => {
  let state: WorldState;
  let world: ReturnType<typeof createWorld>;

  beforeEach(() => {
    state = createWorldState(SEED);
    world = createWorld();
  });

  const plantAt = (x: number, z: number, kind = 'flower_pink'): Command => ({
    t: 'plant',
    pos: { x, y: 0, z },
    kind,
  });

  it('сажает на траву', () => {
    const command = plantAt(inland.x, inland.z);
    expect(validate(command, state, world.reader)).toEqual({ ok: true });

    const effect = applyCommand(command, state, world.reader);
    commitEffect(state, effect);

    expect(state.plants).toHaveLength(1);
    expect(state.plants[0]?.y).toBe(surfaceHeight(world.reader, inland.x, inland.z, WORLD_Y - 1));
  });

  it('не знает выдуманных растений', () => {
    expect(validate(plantAt(inland.x, inland.z, 'баобаб'), state, world.reader)).toEqual({
      ok: false,
      reason: 'unknown_plant',
    });
  });

  it('не сажает в воду', () => {
    let waterX = -1;
    let waterZ = -1;
    for (let z = 0; z < 160 && waterX === -1; z += 1) {
      for (let x = 0; x < WORLD_X; x += 1) {
        if (island.shape.land[x + WORLD_X * z] !== 1) {
          waterX = x;
          waterZ = z;
          break;
        }
      }
    }
    expect(validate(plantAt(waterX, waterZ), state, world.reader)).toEqual({
      ok: false,
      reason: 'underwater',
    });
  });

  it('не сажает две штуки в одну клетку', () => {
    const command = plantAt(inland.x, inland.z);
    commitEffect(state, applyCommand(command, state, world.reader));
    expect(validate(command, state, world.reader)).toEqual({ ok: false, reason: 'occupied' });
  });

  it('куст требует места вокруг', () => {
    commitEffect(state, applyCommand(plantAt(inland.x, inland.z, 'shrub'), state, world.reader));
    expect(validate(plantAt(inland.x + 1, inland.z, 'shrub'), state, world.reader)).toEqual({
      ok: false,
      reason: 'too_close',
    });
  });

  it('у каждого растения свой номер', () => {
    commitEffect(state, applyCommand(plantAt(inland.x, inland.z), state, world.reader));
    commitEffect(state, applyCommand(plantAt(inland.x + 2, inland.z), state, world.reader));
    expect(new Set(state.plants.map((plant) => plant.id)).size).toBe(2);
  });
});

describe('слой команд — нереализованное и разница мира', () => {
  it('команды будущих этапов отклоняются, а не выполняются наполовину', () => {
    const state = createWorldState(SEED);
    const world = createWorld();

    // Переименование появится вместе со своим интерфейсом; остальное уже работает.
    for (const command of [{ t: 'rename', scope: 'island', name: 'Тихая' }] satisfies Command[]) {
      expect(validate(command, state, world.reader)).toEqual({
        ok: false,
        reason: 'not_implemented',
      });
    }

    // Праздник отклоняется по делу, а не потому, что его не написали: нужен очаг.
    expect(validate({ t: 'host_festival' }, state, world.reader)).toEqual({
      ok: false,
      reason: 'needs_firepit',
    });
  });

  it('разница мира переживает запись и чтение', () => {
    const state = createWorldState(SEED);
    const world = createWorld();
    const command: Command = {
      t: 'terraform',
      edits: [
        { pos: { x: inland.x, y: inland.surface, z: inland.z }, mat: Material.AIR },
        { pos: { x: inland.x + 1, y: inland.surface, z: inland.z }, mat: Material.PATH },
      ],
    };
    commitEffect(state, applyCommand(command, state, world.reader));

    const restored = createWorldState(SEED);
    fromWorldPatches(restored, toWorldPatches(state));
    expect([...restored.edits.entries()].sort()).toEqual([...state.edits.entries()].sort());
  });

  it('разница содержит только изменённые клетки', () => {
    const state = createWorldState(SEED);
    const world = createWorld();
    const same = world.reader.material(inland.x, inland.surface, inland.z);

    const command: Command = {
      t: 'terraform',
      edits: [{ pos: { x: inland.x, y: inland.surface, z: inland.z }, mat: same }],
    };
    commitEffect(state, applyCommand(command, state, world.reader));
    expect(state.edits.size).toBe(0);
  });

  it('отменённая правка исчезает из разницы, а не остаётся пустой записью', () => {
    // Иначе сохранение росло бы от одних только отмен, хотя мир от генерации не отличается.
    const state = createWorldState(SEED);
    const world = createWorld();
    const baseline = world.voxels.slice();

    const command: Command = {
      t: 'terraform',
      edits: [{ pos: { x: inland.x, y: inland.surface, z: inland.z }, mat: Material.AIR }],
    };

    const effect = applyCommand(command, state, world.reader);
    commitEffect(state, effect, baseline);
    for (const change of effect.voxels) world.voxels[change.index] = change.material;
    expect(state.edits.size).toBe(1);

    const undo = invertEffect(effect);
    commitEffect(state, undo, baseline);
    for (const change of undo.voxels) world.voxels[change.index] = change.material;
    expect(state.edits.size).toBe(0);
  });

  it('правка на границе чанка задевает соседний чанк', () => {
    // Затенение считается по соседям: без этого на стыке останется светлая полоса.
    const onBorder = dirtyChunks([{ index: voxelIndex(31, 40, 40), material: 0, previous: 5 }]);
    expect(onBorder.size).toBeGreaterThan(1);

    const inside = dirtyChunks([{ index: voxelIndex(16, 40, 16), material: 0, previous: 5 }]);
    expect(inside.size).toBe(1);
  });
});
