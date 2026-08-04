import {
  ACCEPTED,
  generateIsland,
  Material,
  WORLD_X,
  type Command,
  type ValidationResult,
} from '@gavan/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { LiveWorld } from '../state/liveWorld';
import { CommandBus, LocalTransport, type CommandTransport } from './commands';

/**
 * Проверка шины команд, и прежде всего отката.
 *
 * Локальный транспорт всегда подтверждает, поэтому откат при живой игре не срабатывает.
 * На M5.6 он станет основным путём при расхождении с сервером — и там ему нельзя быть
 * единственным непроверенным местом.
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
