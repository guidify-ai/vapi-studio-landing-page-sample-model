#!/usr/bin/env bash
# Backfill project_id before TypeORM synchronize adds NOT NULL
# (existing PoC rows predate multi-project ingress).
set -euo pipefail

ROOT="$(CDPATH="" cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Must match LOCAL_PROJECT_ID in src/project/project.config.ts
LOCAL_PROJECT_ID='4a13e554-972b-4713-b208-15b71bff0493'

IDENTITY_FILE="${ROOT}/config/project.identity.json"
if [[ ! -f "$IDENTITY_FILE" ]]; then
  echo "Missing ${IDENTITY_FILE}" >&2
  exit 1
fi

read_slug_name() {
  python3 -c '
import json, pathlib, sys
d = json.loads(pathlib.Path("config/project.identity.json").read_text())
slug = str(d.get("slug", "")).strip() or "sample-landing-llm"
name = str(d.get("name", "")).strip() or "Sample Landing LLM"
print(slug)
print(name)
'
}
IDENTITY_LINES="$(read_slug_name)"
PROJECT_SLUG="$(printf '%s\n' "$IDENTITY_LINES" | sed -n '1p')"
PROJECT_NAME="$(printf '%s\n' "$IDENTITY_LINES" | sed -n '2p')"

echo ">> Ensuring conversations.project_id (backfill ${LOCAL_PROJECT_ID})"

docker compose exec -T postgres psql -U studio -d sample_landing_llm -v ON_ERROR_STOP=1 <<SQL
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  slug character varying(64) NOT NULL,
  name character varying(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO projects (id, slug, name)
SELECT '${LOCAL_PROJECT_ID}', '${PROJECT_SLUG}', '${PROJECT_NAME}'
WHERE NOT EXISTS (SELECT 1 FROM projects WHERE id = '${LOCAL_PROJECT_ID}');

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS project_id uuid;
UPDATE conversations
SET project_id = '${LOCAL_PROJECT_ID}'
WHERE project_id IS NULL;
ALTER TABLE conversations ALTER COLUMN project_id SET NOT NULL;

ALTER TABLE provider_ingress ADD COLUMN IF NOT EXISTS project_id uuid;
UPDATE provider_ingress
SET project_id = '${LOCAL_PROJECT_ID}'
WHERE project_id IS NULL;

-- Old unique was provider_call_id alone; composite unique is (project_id, provider_call_id).
DO \$\$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'IDX_ca25f5ad65cdc002c4fc74dc33'
  ) THEN
    ALTER TABLE conversations DROP CONSTRAINT "IDX_ca25f5ad65cdc002c4fc74dc33";
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'IDX_ca25f5ad65cdc002c4fc74dc33'
  ) THEN
    DROP INDEX IF EXISTS "IDX_ca25f5ad65cdc002c4fc74dc33";
  END IF;
END
\$\$;
SQL
