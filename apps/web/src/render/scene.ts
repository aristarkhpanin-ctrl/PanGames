import * as THREE from 'three';

/**
 * Каркас сцены. На M0 это пустая сцена цвета глубокой воды: проверяем, что рендерер
 * поднимается, переживает ресайз и не течёт. Остров, вода и свет появляются на M1.
 */

/** --sea-deep, самый тёмный тон сцены (§8 ТЗ). */
const SEA_DEEP = 0x0e4f63;

export interface SceneHandle {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  dispose(): void;
}

export function createScene(canvas: HTMLCanvasElement): SceneHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(SEA_DEEP, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
  camera.position.set(0, 45, 65);
  camera.lookAt(0, 0, 0);

  const resize = (): void => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    // Ограничиваем pixel ratio: бюджет — 60 fps на интегрированной графике (§2 ТЗ).
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  let frameId = 0;
  const loop = (): void => {
    frameId = requestAnimationFrame(loop);
    renderer.render(scene, camera);
  };
  loop();

  return {
    scene,
    camera,
    dispose(): void {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      renderer.dispose();
    },
  };
}
