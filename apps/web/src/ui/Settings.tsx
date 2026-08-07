import { setFamilies } from '../net/api';
import { useGameStore, UI_SCALES } from '../state/store';

/**
 * Масштаб интерфейса (§8 ТЗ, доступность): 100, 125 или 150%.
 *
 * Отдельного окна настроек в игре нет и не нужно: единственное, что человек может захотеть
 * поменять, — это размер букв, и меняется он одной кнопкой по кругу. Всё остальное игра
 * решает сама или берёт из системных настроек — язык, тему, `prefers-reduced-motion`.
 */
export function ScaleButton(): React.JSX.Element {
  const scale = useGameStore((state) => state.uiScale);
  const cycle = useGameStore((state) => state.cycleUiScale);

  const percent = Math.round(scale * 100);
  const next = Math.round((UI_SCALES[(UI_SCALES.indexOf(scale) + 1) % UI_SCALES.length] ?? 1) * 100);

  return (
    <button
      type="button"
      className="scale-button"
      onClick={cycle}
      aria-label={`Размер интерфейса ${String(percent)} процентов, нажми чтобы сделать ${String(next)}`}
    >
      размер {percent}%
    </button>
  );
}

/**
 * Выключить звук. Отдельной кнопкой, а не в глубине настроек: человек, которому звук
 * мешает прямо сейчас, не должен искать, где его убрать.
 */
export function MuteButton(): React.JSX.Element {
  const muted = useGameStore((state) => state.muted);
  const toggle = useGameStore((state) => state.toggleMuted);

  return (
    <button
      type="button"
      className="scale-button"
      onClick={toggle}
      aria-pressed={muted}
      aria-label={muted ? 'Звук выключен, нажми чтобы включить' : 'Звук включён, нажми чтобы выключить'}
    >
      {muted ? 'звук выключен' : 'звук'}
    </button>
  );
}

/**
 * Семьи (§5 ТЗ) — свойство острова, а не браузера, поэтому переключатель живёт рядом
 * с кодом для гостей, а не в верхнем ряду с размером и звуком.
 *
 * По умолчанию выключено. Механика необязательная, и включать её должен человек: остров
 * без детей ничем не хуже, а игра не намекает, что чего-то не хватает.
 */
export function FamiliesToggle(): React.JSX.Element | null {
  const island = useGameStore((state) => state.island);
  const guest = useGameStore((state) => state.guest);
  const families = useGameStore((state) => state.families);
  const setFlag = useGameStore((state) => state.setFamiliesFlag);
  const notice = useGameStore((state) => state.setNotice);

  if (island === null || guest) return null;

  return (
    <button
      type="button"
      className="visit-code"
      aria-pressed={families}
      onClick={() => {
        const next = !families;
        // Показываем сразу, но правдой считаем ответ сервера: настройка живёт там.
        setFlag(next);
        void setFamilies(island.id, next).then((settings) => {
          if (settings === null) {
            setFlag(!next);
            notice('Не получилось изменить настройку. Попробуй ещё раз');
            return;
          }
          setFlag(settings.families);
          notice(
            settings.families
              ? 'Семьи включены. Дети появятся сами, если на острове хорошо'
              : 'Семьи выключены. Те, кто уже родился, никуда не денутся',
          );
        });
      }}
    >
      семьи: <b>{families ? 'включены' : 'выключены'}</b>
    </button>
  );
}
