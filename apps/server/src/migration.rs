use anyhow::{Context, anyhow};
use sqlx::{PgPool, migrate::Migrator};
use tracing::warn;

static MIGRATOR: Migrator = sqlx::migrate!();

pub async fn run_database_migrations(pool: &PgPool) -> anyhow::Result<()> {
    let (legacy_schema, saved_view_trigger_exists, saved_view_trigger_enabled) =
        legacy_saved_view_state(pool).await?;
    if !legacy_schema && saved_view_trigger_exists && !saved_view_trigger_enabled {
        warn!(
            "restoring the Saved View projection trigger after an interrupted database migration"
        );
        restore_saved_view_trigger(pool, true).await?;
    }

    // Migration 27 rewrites Saved Views before removing the legacy Workspace
    // Task Type column. On populated databases that trigger can leave deferred
    // events which PostgreSQL will not allow the later ALTER TABLE to cross.
    // Guard the immutable migration file so its recorded checksum stays valid.
    let guard_legacy_saved_views = legacy_schema && saved_view_trigger_exists;
    if guard_legacy_saved_views {
        warn!(
            "temporarily disabling the Saved View projection trigger for the legacy select-property migration"
        );
        sqlx::query("ALTER TABLE saved_views DISABLE TRIGGER saved_views_config_projection_dirty")
            .execute(pool)
            .await
            .context("failed to prepare the legacy Saved View migration")?;
    }

    let migration_result = MIGRATOR.run(pool).await;
    if !guard_legacy_saved_views {
        return migration_result.context("failed to run database migrations");
    }

    match migration_result {
        Ok(()) => restore_saved_view_trigger(pool, true).await,
        Err(migration_error) => match restore_saved_view_trigger(pool, false).await {
            Ok(()) => Err(migration_error).context("failed to run database migrations"),
            Err(restore_error) => Err(anyhow!(
                "database migration failed: {migration_error}; additionally failed to restore the Saved View projection trigger: {restore_error:#}"
            )),
        },
    }
}

async fn legacy_saved_view_state(pool: &PgPool) -> anyhow::Result<(bool, bool, bool)> {
    sqlx::query_as(
        r#"
        SELECT
        EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'workspaces'
              AND column_name = 'default_task_type_id'
        ),
        EXISTS (
            SELECT 1
            FROM pg_trigger
            JOIN pg_class ON pg_class.oid = pg_trigger.tgrelid
            JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
            WHERE pg_namespace.nspname = current_schema()
              AND pg_class.relname = 'saved_views'
              AND pg_trigger.tgname = 'saved_views_config_projection_dirty'
              AND NOT pg_trigger.tgisinternal
        ),
        EXISTS (
            SELECT 1
            FROM pg_trigger
            JOIN pg_class ON pg_class.oid = pg_trigger.tgrelid
            JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
            WHERE pg_namespace.nspname = current_schema()
              AND pg_class.relname = 'saved_views'
              AND pg_trigger.tgname = 'saved_views_config_projection_dirty'
              AND pg_trigger.tgenabled = 'O'
              AND NOT pg_trigger.tgisinternal
        )
        "#,
    )
    .fetch_one(pool)
    .await
    .context("failed to inspect the legacy Saved View migration state")
}

async fn restore_saved_view_trigger(
    pool: &PgPool,
    migrations_succeeded: bool,
) -> anyhow::Result<()> {
    let mut transaction = pool
        .begin()
        .await
        .context("failed to begin Saved View migration cleanup")?;
    sqlx::query("ALTER TABLE saved_views ENABLE TRIGGER saved_views_config_projection_dirty")
        .execute(&mut *transaction)
        .await
        .context("failed to re-enable the Saved View projection trigger")?;

    if migrations_succeeded {
        sqlx::query(
            r#"
            WITH changed_workspaces AS (
                UPDATE workspaces
                SET config_version = config_version + 1
                RETURNING id, config_version
            )
            INSERT INTO workspace_config_projection_jobs (workspace_id, config_version)
            SELECT id, config_version
            FROM changed_workspaces
            ON CONFLICT (workspace_id) DO UPDATE
            SET config_version = EXCLUDED.config_version,
                attempts = 0,
                next_attempt_at = now(),
                last_error = NULL,
                updated_at = now()
            "#,
        )
        .execute(&mut *transaction)
        .await
        .context("failed to queue Workspace configuration after the Saved View migration")?;
    }

    transaction
        .commit()
        .await
        .context("failed to commit Saved View migration cleanup")
}
