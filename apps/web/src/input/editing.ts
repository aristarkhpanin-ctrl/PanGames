import {
  MAX_TERRAFORM_EDITS,
  Material,
  PLANTS,
  buildingType,
  footprintOf,
  isInsideWorld,
  missingResources,
  surfaceHeight,
  WORLD_Y,
  type Command,
  type RejectReason,
} from '@gavan/shared';
import type { CommandBus } from '../net/commands';
import type { Ghost } from '../render/ghost';
import type { Highlight } from '../render/highlight';
import type { LiveWorld } from '../state/liveWorld';
import { useGameStore, type EditMode } from '../state/store';
import { shortageText } from '../ui/resourceText';
import type { Picker } from './picking';

/**
 * Копание, насыпание и посадка (M2.3, M2.4).
 *
 * Любое изменение уходит командой в шину — прямых записей в мир здесь нет ни одной.
 * Отказ показывается цветом рамки и тихой строкой, без модальных окон (§8, §9 ТЗ).
 */

/** Чем насыпаем. Порядок задаёт перебор по клавише. */
const FILL_MATERIALS = [Material.DIRT, Material.SAND, Material.STONE, Material.PATH] as const;

/** Человеческие объяснения отказов. Каждое говорит, что делать дальше (§8 ТЗ). */
export const REJECT_TEXT: Partial<Record<RejectReason, string>> = {
  bedrock: 'Ниже копать нельзя — это дно острова.',
  ceiling: 'Выше насыпать некуда.',
  nothing_to_dig: 'Здесь пусто. Наведись на землю.',
  outside_world: 'Это уже за краем мира.',
  would_split_island: 'Так остров разделится надвое, и до другого берега будет не дойти.',
  underwater: 'Под водой не растёт. Посади выше линии прибоя.',
  bad_soil: 'На этом грунте не приживётся. Подойдёт трава, земля или песок.',
  occupied: 'Здесь уже что-то растёт.',
  too_close: 'Кусту нужно больше места — отступи на клетку.',
  material_not_allowed: 'Этот материал кладут здания, а не лопата.',
  too_many_edits: 'Слишком большая правка за раз.',
  uneven_ground: 'Земля здесь слишком неровная. Подровняй площадку или поищи ровное место.',
  needs_land: 'Это место в воде. Дом ставят на сушу.',
  needs_water: 'Пирс стоит над водой. Поставь его у берега.',
  requires_missing: 'Сначала нужно построить то, из чего это получится.',
  no_such_building: 'Такого здания здесь уже нет.',
  still_building: 'Здание ещё строится. Оно скоро будет готово.',
  max_level: 'Дальше улучшать некуда — и так хорошо.',
  no_work_here: 'Здесь не работают, здесь живут.',
  crew_full: 'Смена уже полная. Освободи место или поставь ещё одно здание.',
  no_beds: 'Тут негде ночевать.',
  home_full: 'Все кровати заняты. Построй ещё один дом.',
};

export class Editing {
  private pointer: { x: number; y: number } | null = null;
  private painting = false;
  /** Пробел отдан панораме камеры — при нём левая кнопка не копает. */
  private spaceHeld = false;
  /** Клетка, по которой уже отработали: без этого протяжка шлёт команду каждый кадр. */
  private lastPainted = '';
  private readonly detach: (() => void)[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly picker: Picker,
    private readonly highlight: Highlight,
    private readonly ghost: Ghost,
    private readonly bus: CommandBus,
    private readonly world: LiveWorld,
    private readonly onPlantsChanged: () => void,
    private readonly onBuildingsChanged: () => void,
  ) {
    this.bind();
  }

  private get store(): ReturnType<typeof useGameStore.getState> {
    return useGameStore.getState();
  }

  private bind(): void {
    const onMove = (event: PointerEvent): void => {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (this.painting) void this.paint();
    };

    const onDown = (event: PointerEvent): void => {
      // Левая кнопка без модификаторов: остальное забирает камера.
      if (event.button !== 0 || event.altKey) return;
      if (this.spaceHeld) return;

      if (this.store.mode === 'look') {
        this.selectUnderCursor();
        return;
      }

      if (this.store.mode === 'build') {
        void this.placeBuilding();
        event.preventDefault();
        return;
      }

      this.painting = true;
      this.lastPainted = '';
      void this.paint();
      event.preventDefault();
    };

    const onUp = (): void => {
      this.painting = false;
      this.lastPainted = '';
    };

    const onLeave = (): void => {
      this.pointer = null;
      this.highlight.hide();
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === 'Space') this.spaceHeld = false;
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.code === 'Space') this.spaceHeld = true;

      if (event.ctrlKey || event.metaKey) {
        if (event.code === 'KeyZ') {
          event.preventDefault();
          const undone = this.bus.undo();
          this.store.setNotice(undone ? 'Отменено' : 'Отменять пока нечего');
          this.onPlantsChanged();
        }
        return;
      }

      const modes: Partial<Record<string, EditMode>> = {
        Digit1: 'look',
        Digit2: 'dig',
        Digit3: 'fill',
        Digit4: 'plant',
        Digit5: 'build',
      };
      const mode = modes[event.code];
      if (mode !== undefined) {
        this.store.setMode(mode);
        return;
      }

      if (event.code === 'Escape') {
        this.store.setMode('look');
        this.store.selectBuilding(null);
        return;
      }

      if (event.code === 'KeyR' && this.store.mode === 'build') {
        this.store.rotateBuild();
        return;
      }

      if (event.code === 'KeyB') this.store.toggleBrush();
      if (event.code === 'KeyX') this.store.cycleFill(FILL_MATERIALS.length);
      if (event.code === 'KeyC') this.store.cyclePlant(PLANTS.length);
    };

    this.canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    this.canvas.addEventListener('pointerleave', onLeave);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);

    this.detach.push(
      () => {
        this.canvas.removeEventListener('pointerdown', onDown);
      },
      () => {
        window.removeEventListener('pointermove', onMove);
      },
      () => {
        window.removeEventListener('pointerup', onUp);
      },
      () => {
        this.canvas.removeEventListener('pointerleave', onLeave);
      },
      () => {
        window.removeEventListener('keydown', onKey);
      },
      () => {
        window.removeEventListener('keyup', onKeyUp);
      },
    );
  }

  /** Подсветка обновляется каждый кадр: под курсором мог измениться и мир, и режим. */
  updateHighlight(): void {
    const state = this.store;

    if (state.mode === 'build') {
      this.highlight.hide();
      this.updateGhost();
      return;
    }
    this.ghost.hide();

    if (this.pointer === null || state.mode === 'look') {
      this.highlight.hide();
      return;
    }

    const cells = this.targetCells();
    if (cells === null) {
      this.highlight.hide();
      return;
    }

    const command = this.buildCommand(cells);
    const valid = command !== null && this.bus.preview(command).ok;
    this.highlight.show(cells, valid);
  }

  private targetCells(): { x: number; y: number; z: number }[] | null {
    if (this.pointer === null) return null;

    const hit = this.picker.at(
      this.pointer.x,
      this.pointer.y,
      this.canvas.clientWidth,
      this.canvas.clientHeight,
    );
    if (hit === null) return null;

    const state = this.store;
    const place = state.mode !== 'dig';
    const cells = this.highlight.hitCells(hit, state.brush, place);
    return cells.filter((cell) => isInsideWorld(cell.x, cell.y, cell.z));
  }

  private buildCommand(cells: readonly { x: number; y: number; z: number }[]): Command | null {
    const state = this.store;
    if (cells.length === 0) return null;

    if (state.mode === 'plant') {
      // Сажаем по одной клетке: клумба набирается движением, а не одним нажатием.
      const cell = cells[0];
      if (cell === undefined) return null;
      const kind = PLANTS[state.plantIndex % PLANTS.length];
      if (kind === undefined) return null;
      return { t: 'plant', pos: { x: cell.x, y: cell.y, z: cell.z }, kind: kind.id };
    }

    const material =
      state.mode === 'dig'
        ? Material.AIR
        : (FILL_MATERIALS[state.fillIndex % FILL_MATERIALS.length] ?? Material.DIRT);

    return {
      t: 'terraform',
      edits: cells.slice(0, MAX_TERRAFORM_EDITS).map((cell) => ({ pos: cell, mat: material })),
    };
  }

  /** Какое здание сейчас на курсоре: новое из панели или то, которое переносим. */
  private get pendingTypeId(): string | null {
    const state = this.store;
    if (state.movingBuildingId === null) return state.buildTypeId;
    const moving = this.world.state.buildings.find(
      (building) => building.id === state.movingBuildingId,
    );
    return moving?.typeId ?? null;
  }

  /** Куда встанет здание: угол участка и уровень земли под ним. */
  private placementAt(
    typeId: string,
    rotation: 0 | 1 | 2 | 3,
  ): { x: number; y: number; z: number } | null {
    if (this.pointer === null) return null;

    const hit = this.picker.at(
      this.pointer.x,
      this.pointer.y,
      this.canvas.clientWidth,
      this.canvas.clientHeight,
    );
    if (hit === null) return null;

    const type = buildingType(typeId);
    if (type === undefined) return null;

    // Курсор держит здание за середину: так проще целиться, чем углом.
    const size = footprintOf(type, rotation);
    const x = hit.x - Math.floor(size.w / 2);
    const z = hit.z - Math.floor(size.d / 2);

    // Пол здания ложится на самую низкую клетку участка, иначе угол повиснет в воздухе.
    let lowest = Infinity;
    for (let dz = 0; dz < size.d; dz += 1) {
      for (let dx = 0; dx < size.w; dx += 1) {
        if (!isInsideWorld(x + dx, 0, z + dz)) return null;
        const surface = surfaceHeight(this.world, x + dx, z + dz, WORLD_Y - 1);
        lowest = Math.min(lowest, surface);
      }
    }
    if (!Number.isFinite(lowest)) return null;

    return { x, y: lowest + 1, z };
  }

  private buildCommandAt(pos: { x: number; y: number; z: number }): Command | null {
    const state = this.store;
    const rot = state.buildRotation;

    if (state.movingBuildingId !== null) {
      return { t: 'move_building', id: state.movingBuildingId, pos, rot };
    }
    if (state.buildTypeId === null) return null;
    return { t: 'place_building', typeId: state.buildTypeId, pos, rot };
  }

  private updateGhost(): void {
    const typeId = this.pendingTypeId;
    if (typeId === null || this.pointer === null) {
      this.ghost.hide();
      return;
    }

    const pos = this.placementAt(typeId, this.store.buildRotation);
    if (pos === null) {
      this.ghost.hide();
      return;
    }

    const command = this.buildCommandAt(pos);
    const valid = command !== null && this.bus.preview(command).ok;
    this.ghost.show(typeId, pos, this.store.buildRotation, valid);
  }

  private async placeBuilding(): Promise<void> {
    const typeId = this.pendingTypeId;
    if (typeId === null) {
      this.store.setNotice('Выбери, что построить, в панели снизу');
      return;
    }

    const pos = this.placementAt(typeId, this.store.buildRotation);
    if (pos === null) return;

    const command = this.buildCommandAt(pos);
    if (command === null) return;

    const outcome = await this.bus.run(command);
    if (!outcome.result.ok) {
      this.store.setNotice(this.explain(outcome.result.reason, typeId));
      return;
    }

    this.onBuildingsChanged();
    if (this.store.movingBuildingId !== null) {
      this.store.startMoving(null);
      this.store.setNotice('Переехали. Это ничего не стоило');
    }
  }

  /**
   * Отказ по-человечески. «Не хватает 6 досок» вместо кода — и сразу видно,
   * что делать дальше (§8 ТЗ).
   */
  private explain(reason: RejectReason, typeId: string): string {
    if (reason === 'cannot_afford') {
      const type = buildingType(typeId);
      if (type !== undefined) {
        return shortageText(
          missingResources(this.world.state.resources, type.cost),
          this.world.state.buildings,
        );
      }
    }
    if (reason === 'occupied') return 'Здесь уже стоит здание. Поставь рядом.';
    return REJECT_TEXT[reason] ?? 'Сюда не встанет. Попробуй чуть в стороне.';
  }

  /** Клик в режиме «смотрю» открывает карточку здания под курсором. */
  private selectUnderCursor(): void {
    if (this.pointer === null) return;

    const hit = this.picker.at(
      this.pointer.x,
      this.pointer.y,
      this.canvas.clientWidth,
      this.canvas.clientHeight,
    );
    if (hit === null) {
      this.store.selectBuilding(null);
      return;
    }

    // Здания не воксели, поэтому попадание считается по участку, а не по геометрии.
    const found = this.world.state.buildings.find((building) => {
      const type = buildingType(building.typeId);
      if (type === undefined) return false;
      const size = footprintOf(type, building.rotation);
      return (
        hit.x >= building.x &&
        hit.x < building.x + size.w &&
        hit.z >= building.z &&
        hit.z < building.z + size.d
      );
    });

    this.store.selectBuilding(found?.id ?? null);
  }

  private async paint(): Promise<void> {
    const cells = this.targetCells();
    if (cells === null || cells.length === 0) return;

    const first = cells[0];
    if (first === undefined) return;
    const key = `${String(first.x)}:${String(first.y)}:${String(first.z)}`;
    if (key === this.lastPainted) return;
    this.lastPainted = key;

    const command = this.buildCommand(cells);
    if (command === null) return;

    const outcome = await this.bus.run(command);
    if (!outcome.result.ok) {
      const text = REJECT_TEXT[outcome.result.reason];
      if (text !== undefined) this.store.setNotice(text);
      return;
    }

    if (command.t === 'plant') this.onPlantsChanged();
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.detach.length = 0;
  }
}

export { FILL_MATERIALS };
