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

/**
 * Сид острова. На M5 он приедет с сервера вместе с состоянием острова;
 * пока его можно задать в адресе — ?seed=123 — чтобы смотреть разные острова.
 */
const seedParam = new URLSearchParams(window.location.search).get('seed');
const seed = seedParam === null ? 42 : Number.parseInt(seedParam, 10) || 42;

mountHud(hud);

void createScene(canvas, seed).then(() => {
  useGameStore.getState().setWorldReady(true);
});

void checkServerHealth().then((ok) => {
  useGameStore.getState().setServerStatus(ok ? 'online' : 'unreachable');
});
