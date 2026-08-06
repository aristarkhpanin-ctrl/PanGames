#!/usr/bin/env bash
#
# Восстановление из копии на **чистую** базу и проверка, что оно живое (§11 ТЗ).
#
# «Настроен бэкап» ничего не значит. Значение имеет только развёрнутая копия, в которой
# острова на месте. Поэтому скрипт не просто восстанавливает, а сразу считает, что получилось:
# сколько островов, жителей и зданий приехало.
#
#   DATABASE_URL=postgres://... ./scripts/restore.sh backups/gavan-….dump [имя_базы]
#
# Целевая база создаётся заново и удаляется, если уже была: восстанавливать поверх живых
# данных нельзя, это второй способ их потерять.

set -euo pipefail

FILE="${1:?нужен файл копии}"
URL="${DATABASE_URL:?нужен DATABASE_URL}"
TARGET="${2:-gavan_restore_check}"

ADMIN_URL="${URL%/*}/postgres"
TARGET_URL="${URL%/*}/$TARGET"

echo "восстанавливаем $FILE в базу $TARGET"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "drop database if exists $TARGET" >/dev/null
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "create database $TARGET" >/dev/null
pg_restore --no-owner --no-privileges --dbname="$TARGET_URL" "$FILE"

echo
echo "что приехало:"
psql "$TARGET_URL" -v ON_ERROR_STOP=1 --tuples-only --no-align --field-separator=' · ' <<'SQL'
select 'островов', count(*) from islands
union all select 'игроков', count(*) from users
union all select 'жителей', count(*) from villagers
union all select 'зданий', count(*) from buildings
union all select 'записей в дневнике', count(*) from journal
union all select 'подарков в портах', count(*) from gifts
-- Мир хранится как отличия от генерации (§9 ТЗ): в снимке лежат заплатки, а не воксели.
union all select 'заплаток мира', coalesce(sum(jsonb_array_length(world_patch -> 'patches')), 0)
  from island_state where jsonb_typeof(world_patch -> 'patches') = 'array'
union all select 'растений', coalesce(sum(jsonb_array_length(world_patch -> 'plants')), 0)
  from island_state where jsonb_typeof(world_patch -> 'plants') = 'array';
SQL

echo
echo "проверка целостности: у каждого острова есть состояние"
psql "$TARGET_URL" -v ON_ERROR_STOP=1 --tuples-only --no-align -c \
  "select case when count(*) = 0 then 'все острова открываются'
               else count(*)::text || ' островов без состояния' end
     from islands i left join island_state s on s.island_id = i.id
    where s.island_id is null"
