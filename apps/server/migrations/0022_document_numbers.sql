ALTER TABLE workspaces
    ADD COLUMN next_document_number BIGINT NOT NULL DEFAULT 1,
    ADD CONSTRAINT workspaces_next_document_number_positive
        CHECK (next_document_number > 0);

ALTER TABLE documents
    ADD COLUMN document_number BIGINT;

WITH numbered AS (
    SELECT id, workspace_id,
           row_number() OVER (
               PARTITION BY workspace_id ORDER BY created_at, id
           ) AS document_number
    FROM documents
)
UPDATE documents
SET document_number = numbered.document_number
FROM numbered
WHERE documents.id = numbered.id;

UPDATE workspaces
SET next_document_number = counters.next_document_number
FROM (
    SELECT workspace_id, max(document_number) + 1 AS next_document_number
    FROM documents
    GROUP BY workspace_id
) AS counters
WHERE workspaces.id = counters.workspace_id;

ALTER TABLE documents
    ALTER COLUMN document_number SET NOT NULL,
    ADD CONSTRAINT documents_workspace_number_unique
        UNIQUE (workspace_id, document_number),
    ADD CONSTRAINT documents_number_positive CHECK (document_number > 0);
