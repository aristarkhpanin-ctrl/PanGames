/**
 * Звук острова (§8 ТЗ, M7.6). Целиком синтез, ни одного файла.
 *
 * Открытый вопрос №5 в `docs/PLAN.md` спрашивал, откуда брать материал — библиотеки CC0
 * или заказ у композитора. Ответ оказался третьим: ниоткуда. В игре нет ни одной текстуры,
 * цвет берётся из палитры, шум и случайность написаны внутри пакета — звук из чужих записей
 * выпадал бы из этого ряда единственным исключением, да ещё и с лицензиями в придачу.
 *
 * Четыре слоя, и все считаются на месте:
 *
 * - **Море** — розоватый шум через низкий фильтр с медленным дыханием громкости.
 * - **Ветер** — тот же шум выше и тише, с редкими порывами.
 * - **Птицы** — короткие свисты с плавающей высотой, фразами по две-четыре ноты. Днём,
 *   и тем охотнее, чем дальше от воды: у прибоя птиц не слышно.
 * - **Ночь** — сверчки: тон около четырёх килогерц, нарезанный на трели.
 *
 * Всё подчиняется §8: мягко, негромко, никаких резких «дзынь». Ничто не повторяется
 * по расписанию — иначе через десять минут фон превращается в тиканье часов.
 *
 * Полное отключение доступно всегда и запоминается (§8 ТЗ, доступность).
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

/**
 * Выбор игрока про звук живёт рядом с браузером, а не на сервере: это свойство места,
 * где играют, а не острова. Пришёл из тихой комнаты — звук включён, пришёл из офиса — нет.
 */
const MUTED_KEY = 'gavan.muted';

export function savedMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
  } catch {
    // Приватный режим: выбор не переживёт перезагрузку, но работать будет.
  }
}

/** Насколько плавно слои переходят друг в друга. Резких смен быть не должно. */
const FADE_SECONDS = 4;

export class Ambient {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly layers = new Map<AmbientLayer, GainNode>();
  private volumes: Volumes = { ...DEFAULT_VOLUMES };
  private muted = savedMuted();

  /** Когда прозвучит следующая птичья фраза и следующая трель сверчка. */
  private nextBird = 0;
  private nextChirp = 0;

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
    this.layers.set('birds', this.makeVoiceLayer(context, master, 0));
    this.layers.set('night', this.makeVoiceLayer(context, master, 0));
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

    /*
     * Птицы поют днём и тем охотнее, чем дальше от воды. Но не «только в глубине острова»:
     * камера после прибытия стоит на берегу, и с порогом по удалению новый игрок не слышал
     * птиц вообще ни разу. У прибоя их просто меньше, чем моря, — это и имелось в виду.
     * Над самой водой их нет: там и деревьев нет.
     */
    const inland = clamp01(distanceToWater / 22);
    this.fade('birds', night || distanceToWater === 0 ? 0 : 0.18 + inland * 0.4);
    this.fade('night', night ? 0.32 : 0);

    this.speak(context);
  }

  /**
   * Голоса острова. Расписания нет: следующий свист или трель назначаются со случайной
   * паузой, потому что фон, повторяющийся ровно, слышен как метроном, а не как лес.
   */
  private speak(context: AudioContext): void {
    const now = context.currentTime;

    const birds = this.layers.get('birds');
    if (birds !== undefined && birds.gain.value > 0.02) {
      if (now >= this.nextBird) {
        this.singPhrase(context, birds, now);
        this.nextBird = now + 5 + Math.random() * 14;
      }
    } else {
      // Пока птиц не слышно, следующая фраза не копится: иначе к рассвету их накопится сотня.
      this.nextBird = now + 3;
    }

    const crickets = this.layers.get('night');
    if (crickets !== undefined && crickets.gain.value > 0.02) {
      if (now >= this.nextChirp) {
        this.chirp(context, crickets, now);
        this.nextChirp = now + 0.7 + Math.random() * 1.3;
      }
    } else {
      this.nextChirp = now + 1;
    }
  }

  setVolumes(volumes: Partial<Volumes>): void {
    this.volumes = { ...this.volumes, ...volumes };
    this.applyMaster();
  }

  get currentVolumes(): Volumes {
    return { ...this.volumes };
  }

  /** Полное отключение звука доступно всегда и запоминается (§8 ТЗ, доступность). */
  setMuted(muted: boolean): void {
    this.muted = muted;
    rememberMuted(muted);
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

  /** Пустой слой под разовые голоса: сами звуки создаются и умирают по одному. */
  private makeVoiceLayer(context: AudioContext, master: GainNode, level: number): GainNode {
    const gain = context.createGain();
    gain.gain.value = level;
    gain.connect(master);
    return gain;
  }

  /**
   * Птичья фраза: две-четыре ноты подряд.
   *
   * Свист — это скользящая по высоте синусоида с мягким входом и выходом. Резкое начало
   * превращает её в писк, поэтому огибающая всегда с наклоном, даже на сотне миллисекунд.
   */
  private singPhrase(context: AudioContext, layer: GainNode, at: number): void {
    const notes = 2 + Math.floor(Math.random() * 3);
    // У каждой птицы свой голос: одна фраза — один регистр, иначе получается не птица, а хор.
    const base = 1700 + Math.random() * 1500;
    let time = at;

    for (let i = 0; i < notes; i += 1) {
      const length = 0.09 + Math.random() * 0.08;
      const from = base * (0.9 + Math.random() * 0.25);
      const to = from * (1 + (Math.random() * 0.5 - 0.15));

      const voice = context.createOscillator();
      voice.type = 'sine';
      voice.frequency.setValueAtTime(from, time);
      voice.frequency.exponentialRampToValueAtTime(Math.max(to, 200), time + length);

      const shape = context.createGain();
      shape.gain.setValueAtTime(0, time);
      shape.gain.linearRampToValueAtTime(0.35, time + length * 0.25);
      shape.gain.exponentialRampToValueAtTime(0.001, time + length);

      voice.connect(shape).connect(layer);
      voice.start(time);
      voice.stop(time + length + 0.02);

      time += length + 0.05 + Math.random() * 0.09;
    }
  }

  /**
   * Трель сверчка: тон около четырёх килогерц, нарезанный на короткие импульсы.
   *
   * Именно нарезка и делает звук сверчком, а не свистком чайника: непрерывный тон на этой
   * высоте невыносим, а тот же тон импульсами по двадцать миллисекунд — это ночь за окном.
   */
  private chirp(context: AudioContext, layer: GainNode, at: number): void {
    const pulses = 3 + Math.floor(Math.random() * 3);
    const pitch = 3900 + Math.random() * 700;
    const step = 0.055;

    const voice = context.createOscillator();
    voice.type = 'triangle';
    voice.frequency.value = pitch;

    const shape = context.createGain();
    shape.gain.setValueAtTime(0, at);

    for (let i = 0; i < pulses; i += 1) {
      const start = at + i * step;
      shape.gain.setValueAtTime(0, start);
      shape.gain.linearRampToValueAtTime(0.22, start + 0.006);
      shape.gain.linearRampToValueAtTime(0, start + 0.022);
    }

    const end = at + pulses * step;
    voice.connect(shape).connect(layer);
    voice.start(at);
    voice.stop(end + 0.02);
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
