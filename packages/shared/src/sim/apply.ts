import type { Command } from '../commands';
import { deriveSeed } from '../worldgen/rng';
import { WORLD_Y, voxelIndex } from '../voxels';
import {
  EMPTY_EFFECT,
  surfaceHeight,
  type CommandEffect,
  type PlantInstance,
  type VoxelChange,
  type WorldReader,
  type WorldState,
} from './world';

/**
 * Применение команды: что именно изменилось в мире.
 *
 * Функция ничего не мутирует и ничего не решает — решает `validate`. Результат складывается
 * в состояние отдельным шагом (`commitEffect`), и он же умеет разворачиваться назад для отмены.
 */
export function applyCommand(
  command: Command,
  state: WorldState,
  world: WorldReader,
): CommandEffect {
  switch (command.t) {
    case 'terraform': {
      const voxels: VoxelChange[] = [];
      const seen = new Set<number>();

      for (const edit of command.edits) {
        const index = voxelIndex(edit.pos.x, edit.pos.y, edit.pos.z);
        // Одна клетка в пределах команды меняется один раз: иначе отмена вернёт не тот материал.
        if (seen.has(index)) continue;
        seen.add(index);

        const previous = world.material(edit.pos.x, edit.pos.y, edit.pos.z);
        if (previous === edit.mat) continue;

        voxels.push({ index, material: edit.mat, previous });
      }

      return { voxels, plantsAdded: [], plantsRemoved: [] };
    }

    case 'plant': {
      const surface = surfaceHeight(world, command.pos.x, command.pos.z, WORLD_Y - 1);
      const id = `plant-${String(state.nextPlantId)}`;

      const plant: PlantInstance = {
        id,
        kind: command.kind,
        x: command.pos.x,
        y: surface,
        z: command.pos.z,
        // Разброс размера и поворота выводится из сида: хранить их по полям незачем.
        seed: deriveSeed(state.seed, id),
      };

      return { voxels: [], plantsAdded: [plant], plantsRemoved: [] };
    }

    default:
      return EMPTY_EFFECT;
  }
}
