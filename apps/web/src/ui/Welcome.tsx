import { buildingType, welcomeCards, WELCOME_TITLE } from '@gavan/shared';

import { useGameStore } from '../state/store';
import { amountText, RESOURCE_LABEL } from './resourceText';

/**
 * «Пока тебя не было» (§3 ТЗ).
 *
 * Не отчёт, а маленькая радость. Ни процентов, ни графиков, ни дельт — три-шесть спокойных
 * строк о том, что случилось хорошего. Закрывается любым действием и ничего не блокирует:
 * если игрок сразу пошёл смотреть остров, экран просто уходит.
 */
export function Welcome(): React.JSX.Element | null {
  const events = useGameStore((state) => state.catchUp);
  const villagers = useGameStore((state) => state.villagers);
  const dismiss = useGameStore((state) => state.dismissCatchUp);

  if (events === null) return null;

  const cards = welcomeCards(
    events,
    {
      villager: (id) => {
        const villager = villagers.find((person) => person.id === id);
        const name = villager?.name ?? 'Кто-то';
        return name.split(' ')[0] ?? name;
      },
      building: (typeId) => buildingType(typeId)?.name ?? 'Постройка',
      resource: (id, amount) => amountText(id, amount),
      resourceLabel: (id) => RESOURCE_LABEL[id],
    },
    events.length,
  );

  if (cards.length === 0) return null;

  return (
    <div
      className="welcome"
      role="dialog"
      aria-label={WELCOME_TITLE}
      onClick={dismiss}
      onKeyDown={dismiss}
    >
      <div className="welcome-card">
        <h2 className="welcome-title">{WELCOME_TITLE}</h2>

        <ul className="welcome-list">
          {cards.map((card, index) => (
            <li key={`${card.kind}-${String(index)}`} className="welcome-item">
              <span className="welcome-line">{card.title}</span>
              {card.note !== undefined && <span className="welcome-note">{card.note}</span>}
            </li>
          ))}
        </ul>

        <button type="button" className="welcome-close" onClick={dismiss}>
          Хорошо
        </button>
      </div>
    </div>
  );
}
