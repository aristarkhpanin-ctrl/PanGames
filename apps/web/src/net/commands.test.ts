import {
  ACCEPTED,
  createWorldState,
  generateIsland,
  Material,
  voxelIndex,
  WORLD_X,
  type Command,
  type ValidationResult,
} from '@gavan/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { LiveWorld } from '../state/liveWorld';
import { CommandBus, LocalTransport, NetworkTransport, type CommandTransport } from './commands';

/**
 * Проверка шины команд, и прежде всего отката.
 *
 * Локальный транспорт всегда подтверждает; настоящий откат случается с сетевым, когда
 * сервер не согласен с предсказанием. Это и есть самое хрупкое место всего клиента:
 * ошибка здесь означает, что игрок видит не тот мир, в котором живёт.
 */

const SEED = 42;
const island = generateIsland(SEED);

/** Клетка суши подальше от берега: правки там точно не спорят со связностью острова. */
function inlandCell(): { x: number; z: number; y: number } {
  for (let z = 20; z < 140; z += 1) {
    for (let x = 20; x < 140; x += 1) {
      const column = x + WORLD_X * z;
      if (island.shape.land[column] !== 1) continue;
      if ((island.shape.distToWater[column] ?? 0) < 12) continue;
      return { x, z, y: island.surfaceY[column] ?? 0 };
    }
  }
  throw new Error('на острове не нашлось клетки вдали от воды');
}

const cell = inlandCell();

class RejectingTransport implements CommandTransport {
  submit(): Promise<ValidationResult> {
    return Promise.resolve({ ok: false, reason: 'occupied' });
  }
}

function freshWorld(): LiveWorld {
  return new LiveWorld({ ...island, voxels: island.voxels.slice() });
}

const dig: Command = {
  t: 'terraform',
  edits: [{ pos: { x: cell.x, y: cell.y, z: cell.z }, mat: Material.AIR }],
};

describe('CommandBus', () => {
  let world: LiveWorld;
  let dirtySeen: number;

  beforeEach(() => {
    world = freshWorld();
    dirtySeen = 0;
  });

  it('применяет принятую команду и сообщает о задетых чанках', async () => {
    const bus = new CommandBus(world, new LocalTransport(), (update) => {
      dirtySeen += update.dirty.size;
    });

    const outcome = await bus.run(dig);
    expect(outcome.result.ok).toBe(true);
    expect(world.material(cell.x, cell.y, cell.z)).toBe(Material.AIR);
    expect(dirtySeen).toBeGreaterThan(0);
  });

  it('откатывает команду, отклонённую тем, кто решает', async () => {
    const before = world.material(cell.x, cell.y, cell.z);
    const bus = new CommandBus(world, new RejectingTransport(), () => {
      dirtySeen += 1;
    });

    const outcome = await bus.run(dig);

    expect(outcome.result).toEqual({ ok: false, reason: 'occupied' });
    expect(world.material(cell.x, cell.y, cell.z)).toBe(before);
    expect(world.state.edits.size).toBe(0);
    // Два вызова: применили предсказание и вернули обратно. Игрок видит мягкий откат.
    expect(dirtySeen).toBe(2);
  });

  it('откаченную команду нельзя отменить второй раз', async () => {
    const bus = new CommandBus(world, new RejectingTransport(), () => undefined);
    await bus.run(dig);
    expect(bus.canUndo).toBe(false);
  });

  it('отменяет по одной команде и возвращает мир как было', async () => {
    const bus = new CommandBus(world, new LocalTransport(), () => undefined);
    const before = world.material(cell.x, cell.y, cell.z);

    await bus.run(dig);
    await bus.run({
      t: 'terraform',
      edits: [{ pos: { x: cell.x + 1, y: cell.y, z: cell.z }, mat: Material.AIR }],
    });

    expect(bus.undo()).toBe(true);
    expect(world.material(cell.x + 1, cell.y, cell.z)).not.toBe(Material.AIR);
    expect(world.material(cell.x, cell.y, cell.z)).toBe(Material.AIR);

    expect(bus.undo()).toBe(true);
    expect(world.material(cell.x, cell.y, cell.z)).toBe(before);
    expect(bus.undo()).toBe(false);
  });

  it('не применяет команду, отклонённую на предсказании', async () => {
    const bus = new CommandBus(world, new LocalTransport(), () => {
      dirtySeen += 1;
    });

    const outcome = await bus.run({
      t: 'terraform',
      edits: [{ pos: { x: cell.x, y: 0, z: cell.z }, mat: Material.AIR }],
    });

    expect(outcome.result).toEqual({ ok: false, reason: 'bedrock' });
    expect(world.state.edits.size).toBe(0);
    expect(dirtySeen).toBe(0);
  });

  it('локальный транспорт подтверждает, а не судит заново', async () => {
    // Он делит состояние с клиентом: к моменту ответа команда уже применена, и повторная
    // проверка отклонила бы, например, только что посаженный цветок как «здесь занято».
    const transport = new LocalTransport();
    expect(await transport.submit(dig)).toEqual(ACCEPTED);
  });

  it('посадка подряд в разные клетки проходит целиком', async () => {
    const bus = new CommandBus(world, new LocalTransport(), () => undefined);

    for (let i = 0; i < 4; i += 1) {
      const outcome = await bus.run({
        t: 'plant',
        pos: { x: cell.x + i * 2, y: 0, z: cell.z },
        kind: 'flower_pink',
      });
      expect(outcome.result.ok).toBe(true);
    }

    expect(world.plants).toHaveLength(4);
  });
});

describe('сетевой транспорт', () => {
  it('отдаёт вердикт сервера как есть', async () => {
    const transport = new NetworkTransport('island-1', () =>
      Promise.resolve({ outcomes: [{ result: { ok: false, reason: 'cannot_afford' } }] }),
    );

    expect(await transport.submit(dig)).toEqual({ ok: false, reason: 'cannot_afford' });
  });

  it('при пропавшей связи держит то, что игрок уже видит', async () => {
    // Молчание сети — не отказ. Мир вернётся целиком при переподключении, а мигать
    // построенным зданием из-за одного пакета незачем.
    const transport = new NetworkTransport('island-1', () => Promise.resolve(null));
    expect(await transport.submit(dig)).toEqual(ACCEPTED);
  });

  it('откатывает ровно одну команду, а не всю очередь', async () => {
    const world = freshWorld();
    let answer: ValidationResult = ACCEPTED;

    const bus = new CommandBus(
      world,
      new NetworkTransport('island-1', () => Promise.resolve({ outcomes: [{ result: answer }] })),
      () => undefined,
    );

    await bus.run({ t: 'plant', pos: { x: cell.x, y: 0, z: cell.z }, kind: 'flower_pink' });
    await bus.run({ t: 'plant', pos: { x: cell.x + 2, y: 0, z: cell.z }, kind: 'flower_pink' });
    expect(world.plants).toHaveLength(2);

    answer = { ok: false, reason: 'occupied' };
    await bus.run({ t: 'plant', pos: { x: cell.x + 4, y: 0, z: cell.z }, kind: 'flower_pink' });

    // Отклонённая исчезла, две принятые остались на месте.
    expect(world.plants).toHaveLength(2);
    expect(world.plants.map((plant) => plant.x)).toEqual([cell.x, cell.x + 2]);
  });

  it('очередь команд применяется и подтверждается по порядку', async () => {
    const world = freshWorld();
    const seen: number[] = [];

    const bus = new CommandBus(
      world,
      new NetworkTransport('island-1', (_island, commands) => {
        const command = commands[0];
        if (command?.t === 'plant') seen.push(command.pos.x);
        return Promise.resolve({ outcomes: [{ result: ACCEPTED }] });
      }),
      () => undefined,
    );

    await Promise.all(
      [0, 2, 4].map((offset) =>
        bus.run({ t: 'plant', pos: { x: cell.x + offset, y: 0, z: cell.z }, kind: 'flower_pink' }),
      ),
    );

    expect(seen).toEqual([cell.x, cell.x + 2, cell.x + 4]);
    expect(world.plants).toHaveLength(3);
  });
});

describe('согласование с сервером', () => {
  it('расхождение сходится за один приём состояния', () => {
    const world = freshWorld();

    // Клиент выкопал яму, которой сервер не признал.
    const bus = new CommandBus(world, new LocalTransport(), () => undefined);
    void bus.run(dig);
    expect(world.material(cell.x, cell.y, cell.z)).toBe(Material.AIR);

    // Сервер прислал своё состояние: там этой ямы нет, зато есть его собственная правка.
    const authoritative = createWorldState(SEED);
    const otherIndex = voxelIndex(cell.x + 3, cell.y, cell.z);
    authoritative.edits.set(otherIndex, Material.PATH);

    const update = world.adopt(authoritative);

    expect(world.material(cell.x, cell.y, cell.z)).not.toBe(Material.AIR);
    expect(world.material(cell.x + 3, cell.y, cell.z)).toBe(Material.PATH);
    // Перестраиваются только задетые чанки — сцена не пересобирается целиком.
    expect(update.dirty.size).toBeGreaterThan(0);
    expect(update.dirty.size).toBeLessThan(10);
  });
});
