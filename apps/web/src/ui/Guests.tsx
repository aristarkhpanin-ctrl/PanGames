import { GIFTS, POSTCARDS, giftKind, postcard } from '@gavan/shared';
import { useEffect, useState } from 'react';

import { claimGift, fetchGifts, sendGift, type WaitingGift } from '../net/api';
import { useGameStore } from '../state/store';

/**
 * Гости, подарки и открытки (§9 ТЗ).
 *
 * Ни счётчика посещений, ни оценок, ни рейтингов: гость приходит посмотреть и может
 * оставить что-нибудь в порту. Открытка выбирается из готового набора — свободного текста
 * в игре нет нигде, и поэтому нет модерации.
 */

/** Код острова: показывается владельцу, копируется одной кнопкой. */
export function VisitCode(): React.JSX.Element | null {
  const code = useGameStore((state) => state.visitCode);
  const guest = useGameStore((state) => state.guest);
  const notice = useGameStore((state) => state.setNotice);
  if (code === null || code === '' || guest) return null;

  const link = `${window.location.origin}/?code=${code}`;

  return (
    <button
      type="button"
      className="visit-code"
      onClick={() => {
        void navigator.clipboard.writeText(link).then(
          () => {
            notice('Ссылка скопирована. Отправь другу — он придёт посмотреть');
          },
          () => {
            notice(`Код острова: ${code}`);
          },
        );
      }}
    >
      код для гостей: <b>{code}</b>
    </button>
  );
}

/** Что лежит в порту. Подарок ждёт сколько угодно: срока годности нет. */
export function GiftsWaiting(): React.JSX.Element | null {
  const island = useGameStore((state) => state.island);
  const guest = useGameStore((state) => state.guest);
  const setEconomy = useGameStore((state) => state.setEconomy);
  const storageCap = useGameStore((state) => state.storageCap);
  const buildings = useGameStore((state) => state.buildings);
  const [waiting, setWaiting] = useState<WaitingGift[]>([]);

  const applyResources = (resources: Record<string, number>): void => {
    setEconomy(resources, storageCap, buildings);
  };

  useEffect(() => {
    if (island === null || guest) return;
    void fetchGifts(island.id).then(setWaiting);
  }, [island, guest]);

  if (island === null || guest || waiting.length === 0) return null;

  return (
    <aside className="gifts">
      <h2 className="gifts-title">В порту кое-что оставили</h2>
      {waiting.map((gift) => (
        <div key={gift.id} className="gift">
          <p className="gift-name">{giftKind(gift.kind)?.name ?? 'Подарок'}</p>
          {gift.messageId !== null && (
            <p className="gift-card">«{postcard(gift.messageId)?.text ?? ''}»</p>
          )}
          <button
            type="button"
            className="card-action"
            onClick={() => {
              void claimGift(island.id, gift.id).then((result) => {
                setWaiting((rest) => rest.filter((other) => other.id !== gift.id));
                // Склад обновляется сразу, а не со следующим тиком: подарок уже в руках.
                if (result !== null) applyResources(result.resources);
              });
            }}
          >
            Забрать
          </button>
        </div>
      ))}
    </aside>
  );
}

/** Панель гостя: посмотреть и, если хочется, оставить подарок из своего склада. */
export function GuestBar(): React.JSX.Element | null {
  const guest = useGameStore((state) => state.guest);
  const island = useGameStore((state) => state.island);
  const notice = useGameStore((state) => state.setNotice);

  const [open, setOpen] = useState(false);
  const [gift, setGift] = useState(GIFTS[0]?.id ?? '');
  const [card, setCard] = useState(POSTCARDS[0]?.id ?? '');

  if (!guest || island === null) return null;

  return (
    <div className="guest-bar">
      <span className="guest-note">Ты в гостях. Смотри сколько хочешь</span>

      {open ? (
        <>
          <select
            className="guest-select"
            aria-label="Подарок"
            value={gift}
            onChange={(event) => {
              setGift(event.target.value);
            }}
          >
            {GIFTS.map((kind) => (
              <option key={kind.id} value={kind.id}>
                {kind.name}
              </option>
            ))}
          </select>

          <select
            className="guest-select"
            aria-label="Открытка"
            value={card}
            onChange={(event) => {
              setCard(event.target.value);
            }}
          >
            {POSTCARDS.map((text) => (
              <option key={text.id} value={text.id}>
                {text.text}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="guest-send"
            onClick={() => {
              void sendGift(island.id, gift, card).then((result) => {
                if (!result.ok) {
                  // Отказ объясняет, что делать дальше, а не сообщает об ошибке (§8 ТЗ).
                  notice(result.error);
                  return;
                }
                setOpen(false);
                notice('Подарок оставлен в порту. Хозяин заберёт, когда придёт');
              });
            }}
          >
            Оставить
          </button>
        </>
      ) : (
        <button
          type="button"
          className="guest-send"
          onClick={() => {
            setOpen(true);
          }}
        >
          Оставить подарок
        </button>
      )}
    </div>
  );
}
