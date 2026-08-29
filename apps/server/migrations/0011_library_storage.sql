ALTER TABLE documents
    ADD COLUMN storage_name TEXT,
    ADD COLUMN storage_layout_version SMALLINT NOT NULL DEFAULT 0;

UPDATE documents
SET storage_name = lower(id::text);

ALTER TABLE documents
    ALTER COLUMN storage_name SET NOT NULL,
    ADD CONSTRAINT documents_storage_name_portable CHECK (
        octet_length(storage_name) BETWEEN 1 AND 120
        AND storage_name = lower(storage_name)
        AND storage_name ~ '^[[:alnum:]_-]+$'
        AND storage_name !~ '^(con|prn|aux|nul|com[1-9]|lpt[1-9])$'
    ),
    ADD CONSTRAINT documents_storage_layout_version_supported CHECK (
        storage_layout_version IN (0, 1)
    ),
    ADD CONSTRAINT documents_storage_name_unique
        UNIQUE NULLS NOT DISTINCT (workspace_id, parent_id, storage_name);
