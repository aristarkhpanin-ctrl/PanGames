import {
  MAX_TERRAFORM_EDITS,
  Material,
  PLANTS,
  isInsideWorld,
  type Command,
  type RejectReason,
} from '@gavan/shared';
import type { CommandBus } from '../net/commands';
import type { Highlight } from '../render/highlight';
import { useGameStore, type EditMode } from '../state/store';
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
const REJECT_TEXT: Partial<Record<RejectReason, string>> = {
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
    private readonly bus: CommandBus,
    private readonly onPlantsChanged: () => void,
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
      if (event.button !== 0 || event.altKey || this.store.mode === 'look') return;
      if (this.spaceHeld) return;

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
      };
      const mode = modes[event.code];
      if (mode !== undefined) {
        this.store.setMode(mode);
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
