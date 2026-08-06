import {
  buildingType,
  chapterInfo,
  dayPartOf,
  entrySeed,
  hourOfTick,
  quietNeedLine,
  writeEntry,
  type Chapter,
  type JournalKind,
  type SimEvent,
  type TraitId,
  type Villager,
} from '@gavan/shared';

import type { LiveIsland } from './store';

/**
 * Летописец острова (M7.1): превращает события симуляции в записи дневника.
 *
 * Живёт на сервере, потому что дневник — часть мира, а не украшение клиента: он переживает
 * перезагрузку, копится в офлайне и одинаково выглядит во всех вкладках.
 *
 * Записи пишутся не про всё подряд. Дневник, куда попадает каждый чих, читать невозможно —
 * поэтому событий немного, а «тихие наблюдения» появляются редко и не повторяются.
 */

export interface ChronicleEntry {
  kind: JournalKind;
  text: string;
  actors: string[];
}

/** Как часто остров позволяет себе просто наблюдение о дне. Раз в игровые сутки. */
const QUIET_EVERY_TICKS = 144;

/** Как часто кто-то вслух замечает, чего не хватает. Реже, чем раз в полдня. */
const NEED_EVERY_TICKS = 72;

export class Chronicle {
  /** Последняя записанная строка: повторять её подряд нельзя. */
  private lastText = new Map<string, string>();

  /**
   * Собирает записи за тик. Возвращает то, что стоит сохранить, — обычно ничего:
   * дневник наполняется событиями, а не расписанием.
   */
  fromTick(island: LiveIsland, events: readonly SimEvent[]): ChronicleEntry[] {
    const entries: ChronicleEntry[] = [];
    const hour = hourOfTick(island.tick);

    for (const event of events) {
      const villager = island.villagers.find((person) => person.id === event.villagerId);
      if (villager === undefined) continue;

      const entry = this.fromSimEvent(island, event, villager, hour);
      if (entry !== null) entries.push(entry);
    }

    // Раз в сутки остров говорит о себе сам — даже если ничего не случилось.
    if (island.tick % QUIET_EVERY_TICKS === 0) {
      entries.push(this.write(island, 'day', hour, {}, []));
    }

    // И изредка кто-нибудь замечает вслух, чего не хватает. Шёпотом (устав, п. 8).
    if (island.tick % NEED_EVERY_TICKS === 0) {
      const speaker = quietest(island.villagers);
      if (speaker !== undefined) {
        const what = quietNeedLine(speaker.needs, island.tick + speaker.seed);
        if (what !== null) {
          entries.push(
            this.write(island, 'quiet_need', hour, { name: first(speaker.name), what }, [
              speaker.id,
            ]),
          );
        }
      }
    }

    return entries;
  }

  /** Запись о новой главе. Крупно, тихо и один раз (§7 ТЗ). */
  chapterEntry(island: LiveIsland, chapter: Chapter): ChronicleEntry {
    return this.write(
      island,
      'chapter',
      hourOfTick(island.tick),
      {
        what: chapterInfo(chapter).name,
      },
      [],
    );
  }

  /** Запись о празднике. */
  festivalEntry(island: LiveIsland): ChronicleEntry {
    return this.write(island, 'festival', hourOfTick(island.tick), {}, []);
  }

  /** Запись о новом жителе: кто приплыл. */
  arrivalEntry(island: LiveIsland, villager: Villager): ChronicleEntry {
    return this.write(island, 'arrival', hourOfTick(island.tick), { name: first(villager.name) }, [
      villager.id,
    ]);
  }

  /** Запись о достроенном здании. */
  builtEntry(island: LiveIsland, typeId: string): ChronicleEntry {
    const name = buildingType(typeId)?.name.toLowerCase() ?? 'постройка';
    return this.write(island, 'built', hourOfTick(island.tick), { what: name }, []);
  }

  /** Запись о новоселье. */
  settledEntry(island: LiveIsland, villager: Villager): ChronicleEntry {
    return this.write(island, 'settled', hourOfTick(island.tick), { name: first(villager.name) }, [
      villager.id,
    ]);
  }

  /** Запись о госте, который оставил подарок. Ни счётчика, ни оценки — просто событие. */
  giftEntry(island: LiveIsland, guest: string): ChronicleEntry {
    return this.write(island, 'gift', hourOfTick(island.tick), { name: guest }, []);
  }

  /** Запись о новой работе. */
  hiredEntry(island: LiveIsland, villager: Villager): ChronicleEntry {
    return this.write(island, 'hired', hourOfTick(island.tick), { name: first(villager.name) }, [
      villager.id,
    ]);
  }

  private fromSimEvent(
    island: LiveIsland,
    event: SimEvent,
    villager: Villager,
    hour: number,
  ): ChronicleEntry | null {
    switch (event.kind) {
      case 'friendship': {
        const other = island.villagers.find((person) => person.id === event.withId);
        if (other === undefined) return null;
        return this.write(
          island,
          'friendship',
          hour,
          { name: first(villager.name), other: first(other.name) },
          [villager.id, other.id],
        );
      }

      case 'favorite_spot':
        return this.write(island, 'favorite_spot', hour, { name: first(villager.name) }, [
          villager.id,
        ]);

      case 'wish': {
        const what = wishWords(villager);
        return this.write(island, 'wish', hour, { name: first(villager.name), what }, [
          villager.id,
        ]);
      }

      case 'wish_done':
        return this.write(island, 'wish_done', hour, { name: first(villager.name) }, [villager.id]);

      default:
        // Приходы, уходы и смены занятий — не события для дневника, а его внутренняя кухня.
        return null;
    }
  }

  private write(
    island: LiveIsland,
    kind: JournalKind,
    hour: number,
    values: { name?: string; other?: string; what?: string },
    actors: string[],
  ): ChronicleEntry {
    const previous = this.lastText.get(island.id);
    const text = writeEntry({
      kind,
      hour,
      seed: entrySeed(island.seed, island.tick, `${kind}:${actors.join(',')}`),
      ...values,
      ...(previous === undefined ? {} : { previous }),
      ...traitOf(island, actors),
    });

    this.lastText.set(island.id, text);
    return { kind, text, actors };
  }
}

/** Оттенок характера берётся у того, о ком запись: дневник ведут жители, а не остров. */
function traitOf(island: LiveIsland, actors: string[]): { trait?: TraitId } {
  const id = actors[0];
  if (id === undefined) return {};

  const villager = island.villagers.find((person) => person.id === id);
  const trait = villager?.traits[0];
  return trait === undefined ? {} : { trait };
}

/** Кому сейчас хуже всех — тот и заметит вслух. */
function quietest(villagers: readonly Villager[]): Villager | undefined {
  let worst: Villager | undefined;
  for (const villager of villagers) {
    if (worst === undefined || villager.mood < worst.mood) worst = villager;
  }
  return worst;
}

/** Имя без прозвища: в дневнике человека зовут коротко. */
function first(name: string): string {
  return name.split(' ')[0] ?? name;
}

/** Чего именно хочется — словами, которые уместны в записи «{name} мечтает вот о чём: …». */
function wishWords(villager: Villager): string {
  switch (villager.wish?.kind) {
    case 'bench_at_favorite_spot':
      return 'скамейка на том самом месте';
    case 'plant_nearby':
      return 'что-нибудь живое и зелёное поблизости';
    case 'building_nearby':
      return 'место, где можно собраться вечером';
    case 'more_light':
      return 'фонарь, чтобы вечером было светлее';
    default:
      return 'что-то хорошее';
  }
}

/** Часть суток — пригодится интерфейсу, чтобы группировать ленту. */
export { dayPartOf };
