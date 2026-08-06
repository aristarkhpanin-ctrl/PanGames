import { useEffect } from 'react';

import { useGameStore } from '../state/store';

/**
 * Название новой главы (§7 ТЗ).
 *
 * Появляется крупно, тихо и один раз: `Unbounded`, трекинг −2%, без модального окна,
 * без кнопки «продолжить» и без списка наград. Глава — это событие, а не экран.
 */

/** Сколько название держится на экране. Достаточно, чтобы прочитать и не мешать. */
const SHOWN_MS = 6000;

export function ChapterTitle(): React.JSX.Element | null {
  const name = useGameStore((state) => state.chapterName);
  const hide = useGameStore((state) => state.showChapter);

  useEffect(() => {
    if (name === null) return;
    const timer = setTimeout(() => {
      hide(null);
    }, SHOWN_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [name, hide]);

  if (name === null) return null;

  return (
    <p className="chapter-title" role="status">
      {name}
    </p>
  );
}
