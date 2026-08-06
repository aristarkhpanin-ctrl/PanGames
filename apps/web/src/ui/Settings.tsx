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
