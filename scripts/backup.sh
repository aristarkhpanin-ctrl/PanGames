#!/usr/bin/env bash
#
# Резервная копия базы (§11 ТЗ).
#
# Формат custom, а не текстовый: он сжат и восстанавливается параллельно. Имя файла —
# по времени в UTC, чтобы копии сортировались сами и не зависели от часового пояса машины.
#
#   DATABASE_URL=postgres://... ./scripts/backup.sh [каталог]
#
# Бэкап без проверенного восстановления бэкапом не считается — см. restore.sh.

set -euo pipefail

DIR="${1:-backups}"
URL="${DATABASE_URL:?нужен DATABASE_URL}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$DIR/gavan-$STAMP.dump"

mkdir -p "$DIR"
pg_dump --format=custom --no-owner --no-privileges --file="$FILE" "$URL"

SIZE="$(du -h "$FILE" | cut -f1)"
echo "копия готова: $FILE ($SIZE)"
echo "проверить восстановлением: ./scripts/restore.sh $FILE"
