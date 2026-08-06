import type { FastifyInstance } from 'fastify';

/**
 * Ошибки (§11 ТЗ).
 *
 * На игрока ошибка не должна вываливаться техническим текстом. Внутрь лога уходит всё —
 * сообщение, стек, идентификатор запроса; наружу уходит спокойная строка и тот же
 * идентификатор, чтобы разговор «у меня не открылось» можно было связать с записью в логе.
 *
 * Ни стека, ни имени таблицы, ни адреса базы в ответе нет никогда: это и небезопасно,
 * и человеку бесполезно.
 */

/** Что видит игрок, когда сломались мы. Тон тот же, что во всей игре (§8 ТЗ). */
const HUMAN_ERROR = 'Что-то не сложилось на нашей стороне. Остров цел, попробуй ещё раз';

/** Что видит игрок, когда адреса нет. Не «404 Not Found». */
const HUMAN_NOT_FOUND = 'Такой страницы нет. Остров живёт по своему адресу';

export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    request.log.info({ url: request.url }, 'unknown route');
    void reply.code(404).send({ error: HUMAN_NOT_FOUND });
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const status = error.statusCode ?? 500;

    // Отказы, которые мы сами и сформулировали (400, 403, 404, 429), уже человеческие —
    // их текст придуман там, где известно, что делать дальше. Их не трогаем.
    if (status < 500) {
      void reply.code(status).send({ error: error.message });
      return;
    }

    request.log.error({ err: error, reqId: request.id }, 'unhandled error');
    void reply.code(500).send({ error: HUMAN_ERROR, id: request.id });
  });
}
