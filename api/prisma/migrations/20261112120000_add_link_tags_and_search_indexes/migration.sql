-- Enable PostgreSQL trigram and btree_gin extensions for indexed substring & composite search
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Persist link tags directly on links as PostgreSQL TEXT[]
ALTER TABLE "links" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Composite B-tree index for owner-scoped created_at DESC ordering (links list & search pagination)
CREATE INDEX "links_created_by_created_at_idx" ON "links"("created_by", "created_at" DESC);

-- GIN index on tags array for indexed tag containment filtering (tags @> ARRAY[...])
CREATE INDEX "links_tags_gin_idx" ON "links" USING GIN ("tags");

-- GIN trigram indexes for fast case-insensitive substring matching (ILIKE '%...%') on long_url and code
CREATE INDEX "links_long_url_trgm_idx" ON "links" USING GIN ("long_url" gin_trgm_ops);
CREATE INDEX "links_code_trgm_idx" ON "links" USING GIN ("code" gin_trgm_ops);

