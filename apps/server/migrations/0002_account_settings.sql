ALTER TABLE users
    ADD COLUMN display_name TEXT,
    ADD COLUMN theme TEXT NOT NULL DEFAULT 'system',
    ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC',
    ADD COLUMN week_start TEXT NOT NULL DEFAULT 'monday',
    ADD COLUMN date_format TEXT NOT NULL DEFAULT 'locale';

UPDATE users
SET display_name = left(split_part(email, '@', 1), 120);

ALTER TABLE users
    ALTER COLUMN display_name SET NOT NULL,
    ADD CONSTRAINT users_display_name_length CHECK (
        char_length(btrim(display_name)) BETWEEN 1 AND 120
    ),
    ADD CONSTRAINT users_theme CHECK (
        theme IN ('system', 'light', 'dark')
    ),
    ADD CONSTRAINT users_timezone_length CHECK (
        char_length(timezone) BETWEEN 1 AND 64
    ),
    ADD CONSTRAINT users_week_start CHECK (
        week_start IN ('monday', 'sunday')
    ),
    ADD CONSTRAINT users_date_format CHECK (
        date_format IN ('locale', 'yyyy_mm_dd', 'dd_mm_yyyy', 'mm_dd_yyyy')
    );
