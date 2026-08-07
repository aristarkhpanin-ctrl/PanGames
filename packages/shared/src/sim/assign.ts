import type { Command } from '../commands';
import { buildingType, JOB_TRAIT } from '../content/buildings';
import type { TraitId, Villager } from '../types';
import { freeBeds, freeWorkPlaces, homeOf, jobOf, type PlacedBuilding } from './economy';
import { canWork } from './family';
import type { WorldState } from './world';

/**
 * Кто где живёт и работает, если игрок не распорядился иначе (§6 ТЗ).
 *
 * Автоназначение возвращает команды, а не меняет мир: мир меняется только командами, и
 * назначение — не исключение. Поэтому его одинаково видно и на клиенте, и на сервере,
 * и оно так же отменяется.
 *
 * Правило одно: заполняются только пустые места. Никого не переселяют и не переводят
 * с работы на работу — решение игрока всегда сильнее.
 */

export interface AutoAssignOptions {
  /** Кого игрок снял с работы вручную. Таких не трогаем, пока он не решит иначе. */
  detached?: ReadonlySet<string>;
  /** Текущий тик: нужен, чтобы отличить ребёнка от взрослого. */
  tick?: number;
}

export function autoAssignments(
  state: WorldState,
  villagers: readonly Villager[],
  options: AutoAssignOptions = {},
): Command[] {
  const commands: Command[] = [];
  const detached = options.detached ?? new Set<string>();
  const tick = options.tick ?? 0;

  // Занятые места учитываются по ходу дела: иначе за один заход в один дом заселили бы всех.
  const takenBeds = new Map<string, number>();
  const takenJobs = new Map<string, number>();

  for (const villager of villagers) {
    if (homeOf(state.buildings, villager.id) !== undefined) continue;

    const home = bestHome(state.buildings, villager, takenBeds);
    if (home === undefined) continue;

    takenBeds.set(home.id, (takenBeds.get(home.id) ?? 0) + 1);
    commands.push({ t: 'assign_home', villagerId: villager.id, buildingId: home.id });
  }

  for (const villager of villagers) {
    if (detached.has(villager.id)) continue;
    // Ребёнок не работает (§5 ТЗ). Дом ему при этом ищется наравне со всеми.
    if (!canWork(villager, tick)) continue;
    if (jobOf(state.buildings, villager.id) !== undefined) continue;

    const job = bestJob(state.buildings, villager, takenJobs);
    if (job === undefined) continue;

    takenJobs.set(job.id, (takenJobs.get(job.id) ?? 0) + 1);
    commands.push({ t: 'assign_job', villagerId: villager.id, buildingId: job.id });
  }

  return commands;
}

/** Ближайшая свободная кровать. Дом — это про «недалеко», а не про «лучший». */
function bestHome(
  buildings: readonly PlacedBuilding[],
  villager: Villager,
  taken: Map<string, number>,
): PlacedBuilding | undefined {
  let best: PlacedBuilding | undefined;
  let bestDistance = Infinity;

  for (const building of buildings) {
    if (freeBeds(building) - (taken.get(building.id) ?? 0) <= 0) continue;

    const distance = distanceTo(building, villager);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = building;
  }

  return best;
}

/**
 * Работа по душе: сначала совпадение с чертой характера, потом близость.
 * Садовник сам идёт в сад, рыбак — на пирс, и игроку не приходится этим заниматься.
 */
function bestJob(
  buildings: readonly PlacedBuilding[],
  villager: Villager,
  taken: Map<string, number>,
): PlacedBuilding | undefined {
  let best: PlacedBuilding | undefined;
  let bestScore = -Infinity;

  for (const building of buildings) {
    if (freeWorkPlaces(building) - (taken.get(building.id) ?? 0) <= 0) continue;

    const type = buildingType(building.typeId);
    if (type === undefined) continue;

    const wanted = type.jobType === undefined ? undefined : JOB_TRAIT[type.jobType];
    const suits = wanted !== undefined && villager.traits.includes(wanted as TraitId);
    const score = (suits ? 2 : 0) + 1 / (1 + distanceTo(building, villager) / 20);

    if (score <= bestScore) continue;
    bestScore = score;
    best = building;
  }

  return best;
}

function distanceTo(building: PlacedBuilding, villager: Villager): number {
  return Math.hypot(building.x - villager.position.x, building.z - villager.position.z);
}
