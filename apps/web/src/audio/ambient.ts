/**
 * Звук острова (§8 ТЗ, M7.6).
 *
 * ## Честно о том, что здесь есть и чего нет
 *
 * План этого блока — единственный, который не пишется кодом целиком: нужен подбор материала
 * (открытый вопрос №5 в `docs/PLAN.md`). Записей моря, ветра и птиц у проекта пока нет.
 *
 * Поэтому здесь сделано то, что сделать можно и нужно было сделать первым в любом случае:
 * микшер со слоями, раздельными громкостями и правилом «звук не задерживает первый кадр».
 * Слои моря и ветра синтезируются из фильтрованного шума — это настоящий звук, а не заглушка,
 * и он честно звучит как прибой и ветер. Птиц и цикад синтезом не подделать: их слои заведены,
 * но пустуют до появления записей.
 *
 * Всё, что здесь звучит, подчиняется §8: мягко, негромко, никаких резких «дзынь». Полное
 * отключение доступно всегда и запоминается.
 */

export type AmbientLayer = 'sea' | 'wind' | 'birds' | 'night';

export interface Volumes {
  /** Музыка. Луп на главу появится вместе с материалом. */
  music: number;
  /** Окружение: море, ветер, птицы. */
  ambient: number;
  /** Звуки действий. Мягкие и негромкие — иначе они начинают требовать внимания. */
  actions: number;
}

export const DEFAULT_VOLUMES: Volumes = { music: 0.35, ambient: 0.5, actions: 0.4 };

/** Насколько плавно слои переходят друг в друга. Резких смен быть не должно. */
const FADE_SECONDS = 4;

export class Ambient {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly layers = new Map<AmbientLayer, GainNode>();
  private volumes: Volumes = { ...DEFAULT_VOLUMES };
  private muted = false;

  /**
   * Звук запускается только по действию игрока: браузеры не дают включить его раньше,
   * и это правильно — игра не должна начинаться с неожиданного шума.
   */
  start(): void {
    if (this.context !== null) return;

    // Загрузка отложенная: первый кадр не ждёт звука ни секунды (§8 ТЗ).
    const context = new AudioContext();
    this.context = context;

    const master = context.createGain();
    master.gain.value = this.muted ? 0 : this.volumes.ambient;
    master.connect(context.destination);
    this.master = master;

    this.layers.set('sea', this.makeSea(context, master));
    this.layers.set('wind', this.makeWind(context, master));
  }

  /**
   * Микширует слои по времени суток и по тому, где стоит камера: у воды громче море,
   * в роще — птицы (§8 ТЗ).
   */
  update(hour: number, distanceToWater: number): void {
    const context = this.context;
    if (context === null) return;

    const night = hour < 6 || hour >= 20;

    // У воды море ближе и громче; вглубь острова оно уходит, но не пропадает совсем.
    this.fade('sea', clamp01(1 - distanceToWater / 90) * 0.8 + 0.15);
    // Ветер к ночи стихает — так же, как в текстах дневника.
    this.fade('wind', night ? 0.18 : 0.32);
  }

  setVolumes(volumes: Partial<Volumes>): void {
    this.volumes = { ...this.volumes, ...volumes };
    this.applyMaster();
  }

  get currentVolumes(): Volumes {
    return { ...this.volumes };
  }

  /** Полное отключение звука доступно всегда (§8 ТЗ, доступность). */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMaster();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.layers.clear();
  }

  private applyMaster(): void {
    const context = this.context;
    if (this.master === null || context === null) return;
    this.master.gain.setTargetAtTime(
      this.muted ? 0 : this.volumes.ambient,
      context.currentTime,
      0.3,
    );
  }

  private fade(layer: AmbientLayer, level: number): void {
    const gain = this.layers.get(layer);
    const context = this.context;
    if (gain === undefined || context === null) return;

    gain.gain.setTargetAtTime(clamp01(level), context.currentTime, FADE_SECONDS / 3);
  }

  /**
   * Море: розоватый шум через низкий фильтр плюс медленное дыхание громкости.
   * Прибой — это и есть шум, который то накатывает, то отходит.
   */
  private makeSea(context: AudioContext, master: GainNode): GainNode {
    const gain = context.createGain();
    gain.gain.value = 0.4;
    gain.connect(master);

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    filter.Q.value = 0.4;
    filter.connect(gain);

    noise(context).connect(filter);

    // Дыхание: очень медленная волна поверх шума. Восемь секунд на вдох и выдох.
    const breath = context.createOscillator();
    breath.frequency.value = 0.12;
    const depth = context.createGain();
    depth.gain.value = 0.18;
    breath.connect(depth).connect(gain.gain);
    breath.start();

    return gain;
  }

  /** Ветер: тот же шум, но выше и тише, с редким усилением. */
  private makeWind(context: AudioContext, master: GainNode): GainNode {
    const gain = context.createGain();
    gain.gain.value = 0.2;
    gain.connect(master);

    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.7;
    filter.connect(gain);

    noise(context).connect(filter);

    const gust = context.createOscillator();
    gust.frequency.value = 0.05;
    const depth = context.createGain();
    depth.gain.value = 0.1;
    gust.connect(depth).connect(gain.gain);
    gust.start();

    return gain;
  }
}

/** Секунда белого шума в кольце. Дешевле и ровнее, чем генерировать его на лету. */
function noise(context: AudioContext): AudioBufferSourceNode {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = buffer.getChannelData(0);

  // Шум делается один раз при запуске; Math.random здесь допустим — это клиент,
  // а не симуляция, и от него ничего не зависит.
  let last = 0;
  for (let i = 0; i < data.length; i += 1) {
    const white = Math.random() * 2 - 1;
    // Простое сглаживание: белый шум звучит как помехи, сглаженный — как вода.
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.start();
  return source;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
