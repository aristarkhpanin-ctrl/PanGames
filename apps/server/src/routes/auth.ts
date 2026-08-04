import { createHash, randomBytes } from 'node:crypto';

import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Config } from '../config';
import type { Database } from '../db/client';
import { loginTokens, users } from '../db/schema';
import { magicLinkLetter, type MailTransport } from '../mail/transport';

/**
 * Вход по ссылке из письма (§1 ТЗ: паролей нет вообще).
 *
 * Пароль — это то, что можно забыть, подобрать и переиспользовать. В игре про спокойствие
 * ему делать нечего: адрес почты и одноразовая ссылка закрывают всё, ради чего заводят вход.
 */

/** Сколько живёт ссылка. Полчаса хватает, чтобы дойти до почты и не хватает, чтобы утечь. */
const TOKEN_TTL_MS = 30 * 60 * 1000;

/** Сколько писем на один адрес в час. Больше — это уже не забывчивость, а перебор. */
const LETTERS_PER_HOUR = 5;

/** Сколько живёт сессия. Игра не про то, чтобы входить заново каждую неделю. */
const SESSION_TTL = '90d';

export const SESSION_COOKIE = 'gavan_session';

export interface SessionClaims {
  sub: string;
  email: string;
}

/** Отпечаток токена. В базе лежит он, а не сам токен: чтение базы не даёт войти. */
function fingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function registerAuthRoutes(
  app: FastifyInstance,
  db: Database,
  config: Config,
  mail: MailTransport,
): void {
  const requestSchema = z.object({ email: z.email() });

  app.post('/auth/magic-link', async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Нужен адрес почты, на который придёт ссылка' });
    }

    const email = parsed.data.email.trim().toLowerCase();
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const recent = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(loginTokens)
      .where(and(eq(loginTokens.email, email), gt(loginTokens.createdAt, hourAgo)));

    if ((recent[0]?.count ?? 0) >= LETTERS_PER_HOUR) {
      // Отказ объясняет, что делать дальше, а не сообщает о лимите (§8 ТЗ).
      return reply.code(429).send({ error: 'Письмо уже в пути. Загляни в почту через минуту' });
    }

    const token = randomBytes(32).toString('base64url');
    await db.insert(loginTokens).values({
      email,
      tokenHash: fingerprint(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    });

    const url = `${config.PUBLIC_URL}/auth/callback?token=${token}`;
    await mail.send(magicLinkLetter(email, url));

    // Ответ одинаковый всегда: по нему нельзя узнать, заведён ли такой адрес.
    return reply.send({ ok: true });
  });

  app.get('/auth/callback', async (request, reply) => {
    const query = z.object({ token: z.string().min(1) }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'В ссылке нет токена' });

    const hash = fingerprint(query.data.token);
    const found = await db
      .select()
      .from(loginTokens)
      .where(
        and(
          eq(loginTokens.tokenHash, hash),
          isNull(loginTokens.usedAt),
          gt(loginTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);

    const record = found[0];
    if (record === undefined) {
      return reply
        .code(400)
        .send({ error: 'Эта ссылка уже сработала или устарела. Запроси новую' });
    }

    // Токен сгорает сразу: повторный переход по той же ссылке ничего не даёт.
    const burned = await db
      .update(loginTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(loginTokens.id, record.id), isNull(loginTokens.usedAt)))
      .returning({ id: loginTokens.id });

    if (burned.length === 0) {
      return reply.code(400).send({ error: 'Эта ссылка уже сработала. Запроси новую' });
    }

    const user = await upsertUser(db, record.email);
    const claims: SessionClaims = { sub: user.id, email: user.email };
    const jwt = app.jwt.sign(claims, { expiresIn: SESSION_TTL });

    reply.setCookie(SESSION_COOKIE, jwt, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
      path: '/',
      maxAge: 90 * 24 * 60 * 60,
    });

    return reply.redirect(config.WEB_ORIGIN);
  });

  app.get('/me', async (request, reply) => {
    const claims = await verifySession(request);
    if (claims === null) return reply.code(401).send({ error: 'Нужно войти' });

    const found = await db.select().from(users).where(eq(users.id, claims.sub)).limit(1);
    const user = found[0];
    if (user === undefined) return reply.code(401).send({ error: 'Нужно войти' });

    await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));
    return reply.send({ id: user.id, email: user.email });
  });

  app.post('/auth/logout', (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.send({ ok: true });
  });
}

async function upsertUser(db: Database, email: string): Promise<{ id: string; email: string }> {
  const inserted = await db
    .insert(users)
    .values({ email })
    .onConflictDoUpdate({ target: users.email, set: { lastSeenAt: new Date() } })
    .returning({ id: users.id, email: users.email });

  const user = inserted[0];
  if (user === undefined) throw new Error('не удалось завести пользователя');
  return user;
}

/** Кто пришёл. `null` — никто: cookie нет, она испорчена или просрочена. */
export async function verifySession(request: {
  jwtVerify: () => Promise<unknown>;
}): Promise<SessionClaims | null> {
  try {
    const claims = await request.jwtVerify();
    const parsed = z.object({ sub: z.string(), email: z.string() }).safeParse(claims);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
