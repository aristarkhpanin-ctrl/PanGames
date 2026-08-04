import type { BuildingTypeId, PlantId, Vec3 } from './types';

/**
 * Единственный способ изменить мир (§9 ТЗ).
 *
 * Новая механика, меняющая мир, — это новый вариант `Command` плюс правила в `validate`
 * и `apply`, а не прямая запись в стор. Клиент предсказывает, сервер решает; до M5 сервера
 * нет, но форма уже такая, чтобы его появление ничего не переписывало.
 *
 * Варианты объявлены все сразу, включая те, что заработают на M4 и M7: форма контракта
 * фиксируется один раз, реализация добавляется по мере этапов.
 */
export type Command =
  | { t: 'place_building'; typeId: BuildingTypeId; pos: Vec3; rot: 0 | 1 | 2 | 3 }
  | { t: 'move_building'; id: string; pos: Vec3; rot: 0 | 1 | 2 | 3 }
  | { t: 'remove_building'; id: string }
  | { t: 'upgrade_building'; id: string }
  | { t: 'assign_job'; villagerId: string; buildingId: string | null }
  | { t: 'assign_home'; villagerId: string; buildingId: string }
  | { t: 'terraform'; edits: VoxelPlacement[] }
  | { t: 'plant'; pos: Vec3; kind: PlantId }
  | { t: 'rename'; scope: 'island' | 'villager'; id?: string; name: string }
  | { t: 'host_festival' };

export interface VoxelPlacement {
  pos: Vec3;
  mat: number;
}

/** Лимит на одну команду терраформирования (§9 ТЗ). */
export const MAX_TERRAFORM_EDITS = 64;

/**
 * Причина отказа — код, а не текст.
 *
 * Человеческую формулировку собирает интерфейс: она зависит от того, что игрок сейчас делает,
 * и обязана объяснять, что делать дальше (§8 ТЗ). Сервер и клиент говорят кодами.
 */
export type RejectReason =
  | 'not_implemented'
  | 'too_many_edits'
  | 'empty_command'
  | 'outside_world'
  | 'bedrock'
  | 'ceiling'
  | 'material_not_allowed'
  | 'nothing_to_dig'
  | 'no_support'
  | 'would_split_island'
  | 'unknown_plant'
  | 'bad_soil'
  | 'underwater'
  | 'occupied'
  | 'too_close'
  | 'unknown_building'
  | 'no_such_building'
  | 'requires_missing'
  | 'cannot_afford'
  | 'uneven_ground'
  | 'needs_land'
  | 'needs_water'
  | 'still_building'
  | 'max_level'
  | 'no_work_here'
  | 'crew_full'
  | 'no_beds'
  | 'home_full';

export type ValidationResult = { ok: true } | { ok: false; reason: RejectReason };

export const ACCEPTED: ValidationResult = { ok: true };

export function reject(reason: RejectReason): ValidationResult {
  return { ok: false, reason };
}
