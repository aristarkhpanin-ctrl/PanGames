import { useGameStore, type ServerStatus } from '../state/store';

/**
 * HUD живёт поверх канваса и знает про сцену ровно ничего — только то, что лежит в сторе.
 * На M0 здесь заглушка: настоящий интерфейс появляется вместе с игрой (M3.5 и M4.5).
 *
 * Тон текстов — §8 ТЗ: активный залог, сентенс-кейс, без восклицаний.
 */

const statusNote: Record<ServerStatus, string> = {
  unknown: 'Здесь пока только море.',
  online: 'Здесь пока только море. Сервер на связи.',
  unreachable: 'Здесь пока только море. Сервер не отвечает — запусти его командой pnpm dev.',
};

export function Hud(): React.JSX.Element {
  const serverStatus = useGameStore((state) => state.serverStatus);

  return (
    <div className="hud-corner">
      <h1 className="hud-title">Гавань</h1>
      <p className="hud-note">{statusNote[serverStatus]}</p>
    </div>
  );
}
