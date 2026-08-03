import './fonts.css';
import './styles.css';

import { checkServerHealth } from './net/health';
import { createScene } from './render/scene';
import { useGameStore } from './state/store';
import { mountHud } from './ui/mount';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const hud = document.querySelector<HTMLElement>('#hud');

if (!canvas || !hud) {
  throw new Error('В разметке страницы нет канваса #scene или контейнера #hud');
}

createScene(canvas);
mountHud(hud);

void checkServerHealth().then((ok) => {
  useGameStore.getState().setServerStatus(ok ? 'online' : 'unreachable');
  console.info(ok ? 'Сервер отвечает: { ok: true }' : 'Сервер не отвечает');
});
