import './fonts.css';
import './styles.css';

import { worthShowing } from '@gavan/shared';

import { createIsland, fetchIsland, fetchIslandByCode, fetchIslands, fetchMe } from './net/api';
import { createScene } from './render/scene';
import { useGameStore } from './state/store';
import { mountHud } from './ui/mount';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const hud = document.querySelector<HTMLElement>('#hud');

if (!canvas || !hud) {
  throw new Error('В разметке страницы нет канваса #scene или контейнера #hud');
}

mountHud(hud);

/**
 * Вход в игру (M5.3).
 *
 * Мир считает сервер, поэтому первым делом выясняется, кто пришёл. Без сессии показывается
 * не ошибка, а спокойное приглашение: игра начинается с адреса почты, а не с отказа.
 */
async function boot(canvasElement: HTMLCanvasElement): Promise<void> {
  const store = useGameStore.getState();

  // Гость приходит по коду: `?code=ABCDEF`. Смотреть можно и не входя (§9 ТЗ).
  const code = new URLSearchParams(window.location.search).get('code');
  if (code !== null) {
    const visited = await fetchIslandByCode(code);
    if (visited === null) {
      store.setSession(null);
      store.setNotice('Остров по этому коду не нашёлся. Проверь буквы');
      return;
    }

    store.setSession((await fetchMe()) ?? { id: 'guest', email: '' });
    store.setGuest(true);
    store.setIsland({ id: visited.id, name: visited.name ?? 'Остров' });
    await createScene(canvasElement, visited);
    return;
  }

  const me = await fetchMe();
  if (me === null) {
    store.setSession(null);
    return;
  }

  store.setSession(me);

  // Первый вход — остров заводится сам. Спрашивать имя до того, как человек увидел море,
  // значит начинать игру с формы.
  const islands = await fetchIslands();
  const chosen = islands[0] ?? (await createIsland('Гавань'));
  if (chosen === null) {
    store.setNotice('Сервер не отвечает. Всё сохранено, попробуй обновить страницу');
    return;
  }

  const state = await fetchIsland(chosen.id);
  if (state === null) {
    store.setNotice('Не получилось открыть остров. Обнови страницу через минуту');
    return;
  }

  store.setIsland({ id: chosen.id, name: chosen.name });
  store.setVisitCode(state.visitCode ?? null);
  store.setFamiliesFlag(state.settings?.families ?? false);

  // Экран возвращения показывается только если есть о чём рассказать (§3 ТЗ):
  // пустой отчёт хуже отсутствия отчёта.
  if (state.catchUp !== null && worthShowing(state.catchUp)) store.setCatchUp(state.catchUp);

  await createScene(canvasElement, state);
}

void boot(canvas);
