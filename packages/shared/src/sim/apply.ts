import { buildingType } from '../content/buildings';
import type { Command } from '../commands';
import type { ResourceId } from '../types';
import { WORLD_Y, voxelIndex } from '../voxels';
import { deriveSeed } from '../worldgen/rng';
import { footprintOf, refundOf, upgradeCost, type PlacedBuilding } from './economy';
import {
  EMPTY_EFFECT,
  surfaceHeight,
  type BuildingChange,
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
  tick = 0,
): CommandEffect {
  switch (command.t) {
    case 'terraform':
      return { ...EMPTY_EFFECT, voxels: terraformChanges(command.edits, world) };

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

      return { ...EMPTY_EFFECT, plantsAdded: [plant] };
    }

    case 'place_building': {
      const type = buildingType(command.typeId);
      if (type === undefined) return EMPTY_EFFECT;

      const id = `building-${String(state.nextBuildingId)}`;
      const building: PlacedBuilding = {
        id,
        typeId: command.typeId,
        x: command.pos.x,
        y: command.pos.y,
        z: command.pos.z,
        rotation: command.rot,
        level: 1,
        workers: [],
        residents: [],
        // Ресурсы списываются при заказе (§6 ТЗ), чтобы не было микроменеджмента с подвозом.
        progress: 0,
      };

      return {
        ...EMPTY_EFFECT,
        buildings: [{ id, after: building }],
        resources: negate(type.cost),
      };
    }

    case 'move_building': {
      const existing = state.buildings.find((building) => building.id === command.id);
      if (existing === undefined) return EMPTY_EFFECT;

      // Перемещение бесплатно и всегда (устав, п. 6): никакой платы за передумать.
      const moved: PlacedBuilding = {
        ...existing,
        x: command.pos.x,
        y: command.pos.y,
        z: command.pos.z,
        rotation: command.rot,
      };
      return { ...EMPTY_EFFECT, buildings: [{ id: command.id, before: existing, after: moved }] };
    }

    case 'remove_building': {
      const existing = state.buildings.find((building) => building.id === command.id);
      const type = existing === undefined ? undefined : buildingType(existing.typeId);
      if (existing === undefined || type === undefined) return EMPTY_EFFECT;

      return {
        ...EMPTY_EFFECT,
        buildings: [{ id: command.id, before: existing }],
        resources: refundOf(existing, type.cost, tick),
      };
    }

    case 'upgrade_building': {
      const existing = state.buildings.find((building) => building.id === command.id);
      const type = existing === undefined ? undefined : buildingType(existing.typeId);
      if (existing === undefined || type === undefined || existing.level >= 3) return EMPTY_EFFECT;

      const level = (existing.level + 1) as 1 | 2 | 3;
      const upgraded: PlacedBuilding = { ...existing, level };
      return {
        ...EMPTY_EFFECT,
        buildings: [{ id: command.id, before: existing, after: upgraded }],
        resources: negate(upgradeCost(type, existing.level)),
      };
    }

    case 'assign_job':
      return {
        ...EMPTY_EFFECT,
        buildings: reassign(state, command.villagerId, command.buildingId, 'workers'),
      };

    case 'assign_home':
      return {
        ...EMPTY_EFFECT,
        buildings: reassign(state, command.villagerId, command.buildingId, 'residents'),
      };

    default:
      return EMPTY_EFFECT;
  }
}

/**
 * Переписать жителя в другое здание — и работу, и жильё это делают одинаково.
 *
 * Житель числится в одном месте, поэтому сначала он снимается отовсюду, а потом ставится
 * туда, куда просили. `null` вместо здания — снять и никуда не ставить.
 */
function reassign(
  state: WorldState,
  villagerId: string,
  buildingId: string | null,
  field: 'workers' | 'residents',
): BuildingChange[] {
  const changes: BuildingChange[] = [];

  for (const building of state.buildings) {
    if (!building[field].includes(villagerId)) continue;
    changes.push({
      id: building.id,
      before: building,
      after: { ...building, [field]: building[field].filter((id) => id !== villagerId) },
    });
  }

  if (buildingId === null) return changes;

  const target = state.buildings.find((building) => building.id === buildingId);
  if (target === undefined) return changes;

  // Житель мог быть снят с этого же здания парой строк выше — тогда правится уже готовая запись.
  const already = changes.find((change) => change.id === target.id);
  const base = already?.after ?? target;
  const after: PlacedBuilding = { ...base, [field]: [...base[field], villagerId] };

  if (already !== undefined) already.after = after;
  else changes.push({ id: target.id, before: target, after });

  return changes;
}

function terraformChanges(
  edits: readonly { pos: { x: number; y: number; z: number }; mat: number }[],
  world: WorldReader,
): VoxelChange[] {
  const voxels: VoxelChange[] = [];
  const seen = new Set<number>();

  for (const edit of edits) {
    const index = voxelIndex(edit.pos.x, edit.pos.y, edit.pos.z);
    // Одна клетка в пределах команды меняется один раз: иначе отмена вернёт не тот материал.
    if (seen.has(index)) continue;
    seen.add(index);

    const previous = world.material(edit.pos.x, edit.pos.y, edit.pos.z);
    if (previous === edit.mat) continue;

    voxels.push({ index, material: edit.mat, previous });
  }

  return voxels;
}

function negate(cost: Partial<Record<ResourceId, number>>): Partial<Record<ResourceId, number>> {
  const result: Partial<Record<ResourceId, number>> = {};
  for (const [id, amount] of Object.entries(cost) as [ResourceId, number][]) result[id] = -amount;
  return result;
}

export { footprintOf };
