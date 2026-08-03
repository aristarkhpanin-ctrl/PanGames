import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * На M0 в схеме одна таблица. Полная схема из §9 ТЗ (islands, island_state, villagers,
 * buildings, journal, visits, gifts, friends) появляется на M5.1, когда известна её реальная
 * форма — заводить её сейчас значит гадать.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
