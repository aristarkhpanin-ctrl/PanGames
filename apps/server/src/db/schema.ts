import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import type { Villager, WorldSnapshot } from '@gavan/shared';

/**
 * Схема базы по §9 ТЗ.
 *
 * Хранение гибридное (§1 ТЗ): реляционные поля для того, по чему ищут и что связывают
 * (пользователи, острова, визиты, координаты зданий), `jsonb` — для тела мира, где форма
 * меняется вместе с игрой и раскладывать её по колонкам значило бы мигрировать базу
 * на каждый новый параметр здания.
 */

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Одноразовые ссылки для входа (§1 ТЗ: паролей нет вообще).
 *
 * Хранится не сам токен, а его отпечаток: чтение базы не должно давать возможность войти.
 */
export const loginTokens = pgTable(
  'login_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('login_tokens_email_idx').on(table.email, table.createdAt)],
);

export const islands = pgTable(
  'islands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    seed: integer('seed').notNull(),
    chapter: smallint('chapter').notNull().default(1),
    visitCode: text('visit_code').notNull().unique(),
    /** Серверное время последнего расчёта. Клиент это поле не двигает никогда (§9 ТЗ). */
    lastTickAt: timestamp('last_tick_at', { withTimezone: true }).notNull().defaultNow(),
    /** Номер тика мира: по нему считаются время суток и возврат при разборке. */
    tick: integer('tick').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('islands_owner_idx').on(table.ownerId)],
);

export const islandState = pgTable('island_state', {
  islandId: uuid('island_id')
    .primaryKey()
    .references(() => islands.id, { onDelete: 'cascade' }),
  /** Склад: `Record<ResourceId, number>`. Ищут по нему редко, а меняется он каждый тик. */
  resources: jsonb('resources').notNull().$type<Record<string, number>>(),
  /** Снимок мира: только отличия от генерации (§9 ТЗ) — остров весит килобайты. */
  worldPatch: jsonb('world_patch').notNull().$type<WorldSnapshot>(),
  /** Что не относится к самому миру: настройки показа, будущие мелочи. */
  meta: jsonb('meta').notNull().default({}).$type<Record<string, unknown>>(),
  /** Версия формата снимка. Загрузчик умеет читать старую и поднимать её. */
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Ключ составной: имена жителей и зданий даёт симуляция, и они короткие и островные —
 * `villager-1` есть на каждом острове. Делать их глобально уникальными пришлось бы ради
 * одной строки в базе, зато врать про них начал бы весь остальной код.
 */
export const villagers = pgTable(
  'villagers',
  {
    id: text('id').notNull(),
    islandId: uuid('island_id')
      .notNull()
      .references(() => islands.id, { onDelete: 'cascade' }),
    data: jsonb('data').notNull().$type<Villager>(),
  },
  (table) => [
    primaryKey({ columns: [table.islandId, table.id] }),
    index('villagers_island_idx').on(table.islandId),
  ],
);

export const buildings = pgTable(
  'buildings',
  {
    id: text('id').notNull(),
    islandId: uuid('island_id')
      .notNull()
      .references(() => islands.id, { onDelete: 'cascade' }),
    typeId: text('type_id').notNull(),
    // Координаты вынесены в колонки: по ним ищут соседей и считают уют.
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    z: integer('z').notNull(),
    rot: smallint('rot').notNull().default(0),
    level: smallint('level').notNull().default(1),
    progress: real('progress').notNull().default(0),
    data: jsonb('data').notNull().$type<Record<string, unknown>>(),
  },
  (table) => [
    primaryKey({ columns: [table.islandId, table.id] }),
    index('buildings_island_idx').on(table.islandId),
  ],
);

export const journal = pgTable(
  'journal',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    islandId: uuid('island_id')
      .notNull()
      .references(() => islands.id, { onDelete: 'cascade' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    kind: text('kind').notNull(),
    text: text('text').notNull(),
    actors: jsonb('actors').notNull().default([]).$type<string[]>(),
  },
  (table) => [index('journal_island_at_idx').on(table.islandId, table.at)],
);

export const visits = pgTable(
  'visits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    islandId: uuid('island_id')
      .notNull()
      .references(() => islands.id, { onDelete: 'cascade' }),
    guestUserId: uuid('guest_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('visits_island_idx').on(table.islandId, table.at)],
);

export const gifts = pgTable(
  'gifts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    islandId: uuid('island_id')
      .notNull()
      .references(() => islands.id, { onDelete: 'cascade' }),
    fromUserId: uuid('from_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** Открытка выбирается из готового набора: свободного текста в игре нет (§9 ТЗ). */
    messageId: text('message_id'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    claimed: boolean('claimed').notNull().default(false),
  },
  (table) => [index('gifts_island_idx').on(table.islandId, table.claimed)],
);

export const friends = pgTable(
  'friends',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    friendUserId: uuid('friend_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.friendUserId] })],
);

export const islandsRelations = relations(islands, ({ one, many }) => ({
  owner: one(users, { fields: [islands.ownerId], references: [users.id] }),
  state: one(islandState, { fields: [islands.id], references: [islandState.islandId] }),
  villagers: many(villagers),
  buildings: many(buildings),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Island = typeof islands.$inferSelect;
export type IslandState = typeof islandState.$inferSelect;
