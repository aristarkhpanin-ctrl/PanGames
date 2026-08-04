import type * as THREE from 'three';

/**
 * Отладочная панель: счётчик кадра и ползунок времени суток.
 *
 * Бюджеты §2 ТЗ — 60 fps на интегрированной графике, меньше 400 вызовов отрисовки
 * и меньше 250 000 треугольников — должны быть видны во время работы, а не выясняться
 * в конце этапа. Ползунок нужен, чтобы проверять рассвет и закат, не дожидаясь их.
 *
 * Открывается по F3 и по умолчанию скрыта: игроку эти числа не нужны.
 */
export class DebugOverlay {
  private readonly root: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly liveToggle: HTMLInputElement;
  private readonly detach: () => void;

  private frames = 0;
  private elapsed = 0;
  private visible = false;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.root = document.createElement('section');
    this.root.className = 'debug-overlay';
    this.root.hidden = true;

    this.readout = document.createElement('pre');
    this.readout.className = 'debug-readout';

    const label = document.createElement('label');
    label.className = 'debug-row';
    label.textContent = 'Время суток';

    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.max = '24';
    this.slider.step = '0.1';
    this.slider.value = '9';
    label.appendChild(this.slider);

    const liveLabel = document.createElement('label');
    liveLabel.className = 'debug-row';
    this.liveToggle = document.createElement('input');
    this.liveToggle.type = 'checkbox';
    this.liveToggle.checked = true;
    liveLabel.appendChild(this.liveToggle);
    liveLabel.appendChild(document.createTextNode(' Время идёт само'));

    this.root.append(this.readout, label, liveLabel);
    document.body.appendChild(this.root);

    // Ползунок отменяет ход времени: иначе он тут же уезжает из-под пальца.
    this.slider.addEventListener('input', () => {
      this.liveToggle.checked = false;
    });

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'F3') return;
      event.preventDefault();
      this.visible = !this.visible;
      this.root.hidden = !this.visible;
    };

    window.addEventListener('keydown', onKeyDown);
    this.detach = (): void => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }

  get timeRunning(): boolean {
    return this.liveToggle.checked;
  }

  get hour(): number {
    return Number(this.slider.value);
  }

  set hour(value: number) {
    this.slider.value = value.toFixed(1);
  }

  update(deltaSeconds: number): void {
    this.frames += 1;
    this.elapsed += deltaSeconds;
    if (!this.visible || this.elapsed < 0.5) return;

    const fps = this.frames / this.elapsed;
    const frameMs = (this.elapsed / this.frames) * 1000;
    const info = this.renderer.info;

    this.readout.textContent = [
      `${fps.toFixed(0)} fps · ${frameMs.toFixed(1)} мс`,
      `вызовов отрисовки: ${String(info.render.calls)} / 400`,
      `треугольников: ${info.render.triangles.toLocaleString('ru')} / 250 000`,
      `геометрий: ${String(info.memory.geometries)}`,
      `час: ${this.hour.toFixed(1)}`,
    ].join('\n');

    this.frames = 0;
    this.elapsed = 0;
  }

  dispose(): void {
    this.detach();
    this.root.remove();
  }
}
