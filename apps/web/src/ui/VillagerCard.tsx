import {
  bondWord,
  friendsOf,
  moodWord,
  statusLine,
  trait,
  villagerLook,
  type Villager,
} from '@gavan/shared';

import { useGameStore } from '../state/store';
import { WISH_WORDS } from './wishText';

/**
 * Карточка жителя (§8 ТЗ): портрет, имя, чем занят, настроение словом, две черты.
 *
 * Ни одного процента: настроение — это слово, а не шкала. Проценты превращают человека
 * в датчик, а игру — в таблицу.
 */
export function VillagerCard({ villager }: { villager: Villager }): React.JSX.Element {
  const close = useGameStore((state) => state.selectVillager);
  const everyone = useGameStore((state) => state.villagers);
  const look = villagerLook(villager.seed);

  const friends = friendsOf(villager, everyone);
  const closest = villager.bonds.reduce<{ level: 0 | 1 | 2 | 3; withId: string } | null>(
    (best, bond) => (best === null || bond.level > best.level ? bond : best),
    null,
  );

  return (
    <aside className="card" role="dialog" aria-label={`Житель ${villager.name}`}>
      <header className="card-head">
        <span
          className="card-face"
          style={{ background: `#${look.skin.toString(16).padStart(6, '0')}` }}
        >
          <i
            className="card-hair"
            style={{ background: `#${look.hair.toString(16).padStart(6, '0')}` }}
          />
        </span>
        <span>
          <b className="card-name">{villager.name}</b>
          {villager.nickname !== undefined && (
            <span className="card-nickname">, {villager.nickname}</span>
          )}
        </span>
        <button
          type="button"
          className="card-close"
          onClick={() => {
            close(null);
          }}
          aria-label="Закрыть карточку"
        >
          ✕
        </button>
      </header>

      <p className="card-now">{statusLine(villager.state, villager.seed)}</p>

      <dl className="card-facts">
        <dt>Настроение</dt>
        <dd>{moodWord(villager.mood)}</dd>

        <dt>Характер</dt>
        <dd>{villager.traits.map((id) => trait(id)?.name ?? id).join(', ')}</dd>

        <dt>Дом</dt>
        <dd>{villager.homeId === undefined ? 'ночует под открытым небом' : 'есть'}</dd>

        {friends.length > 0 && (
          <>
            <dt>Друзья</dt>
            <dd>
              {friends.map((friend) => friend.name.split(' ')[0] ?? friend.name).join(', ')}
              {closest !== null && closest.level === 3 ? ' — и совсем близкие' : ''}
            </dd>
          </>
        )}

        {friends.length === 0 && closest !== null && (
          <>
            <dt>Знакомства</dt>
            <dd>пока {bondWord(closest.level)}</dd>
          </>
        )}

        {villager.favoriteSpot !== undefined && (
          <>
            <dt>Любимое место</dt>
            <dd>есть, у самой воды</dd>
          </>
        )}
      </dl>

      {villager.wish !== undefined && <p className="card-wish">{WISH_WORDS[villager.wish.kind]}</p>}

      <p className="card-hint">
        {villager.homeId === undefined
          ? 'Крыши над головой пока нет — дома появятся, когда будет что строить.'
          : ''}
      </p>
    </aside>
  );
}

/** Свёрнутая колонка справа: аватар и настроение. Клик открывает карточку (§8 ТЗ). */
export function VillagerColumn({
  villagers,
}: {
  villagers: readonly Villager[];
}): React.JSX.Element {
  const selected = useGameStore((state) => state.selectedVillager);
  const select = useGameStore((state) => state.selectVillager);
  const touch = useGameStore((state) => state.touch);
  const mode = useGameStore((state) => state.mode);

  // На телефоне список жителей и панель строительства не помещаются вместе, и список уходит:
  // пока человек ставит дом, ему нужен остров, а не четыре карточки поверх него.
  if (touch && mode === 'build') return <></>;

  return (
    <nav className="column" aria-label="Жители">
      {villagers.map((villager) => {
        const look = villagerLook(villager.seed);
        const word = moodWord(villager.mood);

        return (
          <button
            type="button"
            key={villager.id}
            className={`column-item${selected === villager.id ? ' is-open' : ''}`}
            onClick={() => {
              select(selected === villager.id ? null : villager.id);
            }}
            // Настроение читается и словом, и формой значка — не только цветом (§8 ТЗ).
            title={`${villager.name} — ${word}`}
          >
            <span
              className="column-face"
              style={{ background: `#${look.skin.toString(16).padStart(6, '0')}` }}
            />
            <span className={`column-mood mood-${moodShape(word)}`} aria-hidden="true" />
            <span className="column-name">{villager.name}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** Форма значка настроения. Дальтоник должен различать его без цвета. */
function moodShape(word: ReturnType<typeof moodWord>): string {
  switch (word) {
    case 'светится':
      return 'bright';
    case 'радуется':
      return 'glad';
    case 'спокоен':
      return 'calm';
    case 'задумчив':
      return 'thoughtful';
    default:
      return 'sad';
  }
}
