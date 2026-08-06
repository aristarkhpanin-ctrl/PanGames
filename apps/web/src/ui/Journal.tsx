import { useEffect, useState } from 'react';

import { fetchJournal, type JournalEntry } from '../net/api';
import { useGameStore } from '../state/store';

/**
 * Дневник острова (§8 ТЗ) — signature-элемент игры.
 *
 * Хронологическая лента рукописных заметок от лица жителей. Единственное место, где
 * используется `Caveat`: это его подпись. Имена кликабельны и открывают карточку человека.
 *
 * Ни счётчика непрочитанного, ни значка на кнопке, ни «новых записей за сегодня» — дневник
 * читают, когда хочется, а не когда напомнили.
 */
export function Journal(): React.JSX.Element | null {
  const open = useGameStore((state) => state.journalOpen);
  const toggle = useGameStore((state) => state.toggleJournal);
  const island = useGameStore((state) => state.island);
  const villagers = useGameStore((state) => state.villagers);
  const live = useGameStore((state) => state.journal);
  const selectVillager = useGameStore((state) => state.selectVillager);

  const [saved, setSaved] = useState<JournalEntry[]>([]);

  // Лента подгружается при открытии: держать её в памяти всё время незачем.
  useEffect(() => {
    if (!open || island === null) return;
    void fetchJournal(island.id).then(setSaved);
  }, [open, island]);

  if (!open) return null;

  // Записи этой сессии приезжают с тиками и ложатся сверху — ждать перезапроса не нужно.
  // Те же записи приходят и с сервера, поэтому лента склеивается по тексту: иначе всё,
  // что случилось при открытом дневнике, двоилось бы.
  const seen = new Set<string>();
  const entries = [...live, ...saved].filter((entry) => {
    const key = `${entry.text}|${entry.actors.join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <aside className="journal" aria-label="Дневник острова">
      <header className="journal-head">
        <h2 className="journal-title">Дневник</h2>
        <button type="button" className="card-close" onClick={toggle}>
          закрыть
        </button>
      </header>

      {entries.length === 0 ? (
        <p className="journal-empty">
          Пока пусто. Здесь появятся заметки о том, что происходит на острове.
        </p>
      ) : (
        <ol className="journal-list">
          {entries.map((entry, index) => (
            <li key={`${entry.text}-${String(index)}`} className="journal-entry">
              <p className="journal-text">{entry.text}</p>
              {entry.actors.length > 0 && (
                <p className="journal-actors">
                  {entry.actors.map((id) => {
                    const villager = villagers.find((person) => person.id === id);
                    if (villager === undefined) return null;
                    return (
                      <button
                        key={id}
                        type="button"
                        className="journal-actor"
                        onClick={() => {
                          selectVillager(id);
                        }}
                      >
                        {villager.name.split(' ')[0] ?? villager.name}
                      </button>
                    );
                  })}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
