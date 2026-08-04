import type { FastifyBaseLogger } from 'fastify';

/**
 * Отправка почты (M5.2).
 *
 * Абстракция нужна не ради красоты, а ради разработки: настроенная почта не должна быть
 * условием того, чтобы запустить игру у себя. Консольная реализация печатает ссылку в лог,
 * и этого достаточно для всей работы над игрой.
 *
 * Настоящий отправитель выбирается позже (открытый вопрос №1 в docs/PLAN.md).
 */

export interface Letter {
  to: string;
  subject: string;
  text: string;
}

export interface MailTransport {
  send(letter: Letter): Promise<void>;
}

/** Разработка: письмо печатается в лог, ссылка кликается прямо из терминала. */
export class ConsoleMail implements MailTransport {
  constructor(private readonly log: FastifyBaseLogger) {}

  send(letter: Letter): Promise<void> {
    this.log.info(`\n── письмо для ${letter.to} ──\n${letter.subject}\n\n${letter.text}\n──`);
    return Promise.resolve();
  }
}

/** Тесты: письма складываются в память, чтобы по ним можно было пройти. */
export class MemoryMail implements MailTransport {
  readonly sent: Letter[] = [];

  send(letter: Letter): Promise<void> {
    this.sent.push(letter);
    return Promise.resolve();
  }
}

/**
 * Письмо со ссылкой для входа. Тон §8 ТЗ: спокойно, без восклицаний и без маркетинга.
 * Письмо от игры про тишину не должно кричать.
 */
export function magicLinkLetter(to: string, url: string): Letter {
  return {
    to,
    subject: 'Ссылка для входа в Гавань',
    text: [
      'Здравствуй.',
      '',
      'Вот ссылка, чтобы войти. Она работает один раз и в течение получаса:',
      url,
      '',
      'Если это письмо пришло не тебе — просто закрой его, ничего не случится.',
    ].join('\n'),
  };
}
