import { useGameStore } from '../state/store';

/**
 * HUD живёт поверх канваса и знает про сцену ровно ничего — только то, что лежит в сторе.
 * Настоящий интерфейс появляется вместе с игрой (M3.5 и M4.5).
 *
 * Тон текстов — §8 ТЗ: активный залог, сентенс-кейс, без восклицаний.
 */
export function Hud(): React.JSX.Element {
  const worldReady = useGameStore((state) => state.worldReady);

  return (
    <div className="hud-corner">
      <h1 className="hud-title">Гавань</h1>
      <p className="hud-note">
        {worldReady ? 'Остров ждёт, когда на него сойдут на берег.' : 'Остров поднимается из моря.'}
      </p>
    </div>
  );
}
