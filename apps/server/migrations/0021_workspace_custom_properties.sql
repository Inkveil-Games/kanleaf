CREATE TABLE custom_property_definitions (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    property_type TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL,
    configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, id),
    CONSTRAINT custom_property_definitions_name_valid CHECK (
        name = btrim(name) AND char_length(name) BETWEEN 1 AND 120
    ),
    CONSTRAINT custom_property_definitions_type_valid CHECK (
        property_type IN (
            'text', 'number', 'date', 'single_select',
            'multi_select', 'checkbox', 'url'
        )
    ),
    CONSTRAINT custom_property_definitions_description_valid CHECK (
        char_length(description) <= 500
    ),
    CONSTRAINT custom_property_definitions_position_valid CHECK (position >= 0),
    CONSTRAINT custom_property_definitions_configuration_object CHECK (
        jsonb_typeof(configuration) = 'object'
    )
);

CREATE UNIQUE INDEX custom_property_definitions_workspace_name_idx
    ON custom_property_definitions(workspace_id, lower(name));

CREATE INDEX custom_property_definitions_workspace_order_idx
    ON custom_property_definitions(workspace_id, archived_at, position, id);

CREATE TABLE custom_property_options (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    property_id UUID NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    position INTEGER NOT NULL,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, property_id, id),
    CONSTRAINT custom_property_options_definition_fk
        FOREIGN KEY (workspace_id, property_id)
        REFERENCES custom_property_definitions(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT custom_property_options_name_valid CHECK (
        name = btrim(name) AND char_length(name) BETWEEN 1 AND 120
    ),
    CONSTRAINT custom_property_options_color_valid CHECK (
        color ~ '^#[0-9A-F]{6}$'
    ),
    CONSTRAINT custom_property_options_position_valid CHECK (position >= 0)
);

CREATE UNIQUE INDEX custom_property_options_property_name_idx
    ON custom_property_options(property_id, lower(name));

CREATE INDEX custom_property_options_property_order_idx
    ON custom_property_options(workspace_id, property_id, archived_at, position, id);

CREATE TABLE task_custom_property_values (
    workspace_id UUID NOT NULL,
    task_id UUID NOT NULL,
    property_id UUID NOT NULL,
    value JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, property_id),
    CONSTRAINT task_custom_property_values_task_fk
        FOREIGN KEY (workspace_id, task_id)
        REFERENCES tasks(workspace_id, id)
        ON DELETE CASCADE,
    CONSTRAINT task_custom_property_values_definition_fk
        FOREIGN KEY (workspace_id, property_id)
        REFERENCES custom_property_definitions(workspace_id, id)
        ON DELETE CASCADE
);

CREATE INDEX task_custom_property_values_workspace_property_idx
    ON task_custom_property_values(workspace_id, property_id, task_id);

ALTER TABLE task_projection_jobs
    ADD COLUMN cleanup_property_names TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD CONSTRAINT task_projection_jobs_cleanup_names_valid CHECK (
        array_position(cleanup_property_names, NULL) IS NULL
    );

CREATE TRIGGER custom_property_definitions_config_projection_dirty
AFTER INSERT OR UPDATE OR DELETE ON custom_property_definitions
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('workspace_id');

CREATE TRIGGER custom_property_options_config_projection_dirty
AFTER INSERT OR UPDATE OR DELETE ON custom_property_options
FOR EACH ROW EXECUTE FUNCTION kanleaf_mark_workspace_config_dirty('workspace_id');
