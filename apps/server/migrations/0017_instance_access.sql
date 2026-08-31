CREATE TABLE instance_settings (
    id SMALLINT PRIMARY KEY,
    restricted_access BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT instance_settings_singleton CHECK (id = 1)
);

INSERT INTO instance_settings (id) VALUES (1);

CREATE TABLE instance_allowed_emails (
    email TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT instance_allowed_emails_normalized CHECK (
        email = lower(btrim(email))
        AND char_length(email) BETWEEN 3 AND 320
    )
);
