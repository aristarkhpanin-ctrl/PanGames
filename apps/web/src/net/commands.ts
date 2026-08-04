import {
  ACCEPTED,
  applyCommand,
  validate,
  type Command,
  type CommandEffect,
  type ValidationResult,
} from '@gavan/shared';

import type { LiveWorld, WorldUpdate } from '../state/liveWorld';

/**
 * Шина команд — единственный путь, которым мир меняется (§9 ТЗ).
 *
 * Сейчас транспорт локальный: команда проверяется и применяется на месте. На M5.6 сюда
 * встанет сетевой транспорт, и это будет правка одного файла — при условии, что никто
 * не научился менять мир мимо шины. Если для перехода понадобится больше, значит слой
 * где-то обходили, и это надо найти.
 */

export interface CommandTransport {
  /** Отдаёт команду тому, кто принимает решение. */
  submit(command: Command): Promise<ValidationResult>;
}

/**
 * Локальный исполнитель: сам себе сервер. Живёт до появления настоящего (M5).
 *
 * Он подтверждает команду, а не проверяет её заново, и это не упрощение, а необходимость:
 * состояние у него общее с клиентом, и к моменту ответа команда уже применена. Повторная
 * проверка судила бы о мире, где команда уже случилась — посадка увидела бы собственный
 * цветок и отклонила сама себя.
 *
 * Настоящий сервер (M5.4) держит своё состояние и проверяет команду ДО того, как применит,
 * поэтому такой беды у него не будет.
 */
export class LocalTransport implements CommandTransport {
  submit(_command: Command): Promise<ValidationResult> {
    return Promise.resolve(ACCEPTED);
  }
}

export interface CommandOutcome {
  result: ValidationResult;
}

interface HistoryEntry {
  command: Command;
  effect: CommandEffect;
}

/** Сколько шагов назад можно отменить. Отменяемость — пункт устава, а не удобство. */
const HISTORY_LIMIT = 200;

export class CommandBus {
  private readonly history: HistoryEntry[] = [];
  /** Команды, отправленные и ещё не подтверждённые. При отказе разворачиваются назад. */
  private readonly pending = new Map<number, CommandEffect>();
  private nextTicket = 0;

  constructor(
    private readonly world: LiveWorld,
    private readonly transport: CommandTransport,
    private readonly onChange: (update: WorldUpdate) => void,
  ) {}

  /** Вердикт без применения — для подсветки: рамка краснеет ещё до нажатия. */
  preview(command: Command): ValidationResult {
    return validate(command, this.world.state, this.world);
  }

  /**
   * Клиент применяет команду сразу, а решение приходит следом. При локальном транспорте
   * вердикт всегда совпадает с предсказанием, но откат написан и проверен уже сейчас —
   * иначе на M5.6 он окажется единственным непроверенным местом.
   */
  async run(command: Command): Promise<CommandOutcome> {
    const predicted = validate(command, this.world.state, this.world);
    if (!predicted.ok) return { result: predicted };

    const effect = applyCommand(command, this.world.state, this.world);
    const update = this.world.applyEffect(effect);

    const ticket = this.nextTicket;
    this.nextTicket += 1;
    this.pending.set(ticket, effect);

    this.history.push({ command, effect });
    if (this.history.length > HISTORY_LIMIT) this.history.shift();

    this.onChange(update);

    const verdict = await this.transport.submit(command);
    this.pending.delete(ticket);

    if (!verdict.ok) {
      // Мягкий откат без модальных окон (§9 ТЗ): постройка тихо исчезает, воксель возвращается.
      this.history.pop();
      this.onChange(this.world.revertEffect(effect));
    }

    return { result: verdict };
  }

  undo(): boolean {
    const entry = this.history.pop();
    if (entry === undefined) return false;

    this.onChange(this.world.revertEffect(entry.effect));
    return true;
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  get inFlight(): number {
    return this.pending.size;
  }
}
