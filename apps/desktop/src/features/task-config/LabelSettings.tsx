import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { SettingsArticle } from '../settings/SettingsArticle';
import { errorMessage } from '../settings/utils';
import type { ApiContext } from '../workspace/api';
import type {
  TaskConfiguration,
  TaskLabel,
  Workspace,
} from '../workspace/types';
import { createTaskLabel, deleteTaskLabel, updateTaskLabel } from './api';

interface LabelSettingsProps {
  context: ApiContext;
  workspace: Workspace;
  configuration: TaskConfiguration;
  onChanged: () => Promise<void>;
}

export function LabelSettings(props: LabelSettingsProps) {
  const canManage =
    props.workspace.role === 'owner' || props.workspace.role === 'admin';
  const [name, setName] = useState('');
  const [color, setColor] = useState('#7F9C84');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const active = props.configuration.labels.filter(
    (label) => !label.archived_at,
  );
  const archived = props.configuration.labels.filter(
    (label) => label.archived_at,
  );

  async function create(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createTaskLabel(props.context, props.workspace.id, {
        name,
        color,
        description,
      });
      setName('');
      setDescription('');
      await props.onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await props.onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <SettingsArticle
      className="configuration-settings"
      eyebrow="Workspace"
      title="Labels"
      description="Create a concise shared vocabulary for categorizing work across Inbox and projects."
    >
      {canManage && (
        <form
          className="configuration-create-form label-create-form"
          onSubmit={(event) => void create(event)}
        >
          <label>
            <span>Name</span>
            <input
              required
              maxLength={120}
              value={name}
              placeholder="Label name"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="color-field">
            <span>Color</span>
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value.toUpperCase())}
            />
          </label>
          <label>
            <span>Description</span>
            <input
              maxLength={500}
              value={description}
              placeholder="Optional context"
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <button
            className="primary-button compact-button"
            type="submit"
            disabled={saving}
          >
            {saving ? 'Adding…' : 'Add label'}
          </button>
        </form>
      )}
      {error && (
        <p className="settings-error configuration-message" role="alert">
          {error}
        </p>
      )}
      {active.length === 0 ? (
        <div className="settings-empty">
          <strong>No active labels</strong>
          <p>
            Add labels when your Workspace needs a shared way to categorize
            tasks.
          </p>
        </div>
      ) : (
        <div className="configuration-list" aria-label="Active task labels">
          {active.map((label) => (
            <LabelRow
              key={label.id}
              label={label}
              canManage={canManage}
              onSave={(patch) =>
                run(() =>
                  updateTaskLabel(
                    props.context,
                    props.workspace.id,
                    label.id,
                    patch,
                  ),
                )
              }
              onArchive={() =>
                run(() =>
                  updateTaskLabel(props.context, props.workspace.id, label.id, {
                    archived: true,
                  }),
                )
              }
              onDelete={() =>
                run(() =>
                  deleteTaskLabel(props.context, props.workspace.id, label.id),
                )
              }
            />
          ))}
        </div>
      )}
      {archived.length > 0 && (
        <section className="configuration-archive">
          <h2>Archived</h2>
          {archived.map((label) => (
            <div className="configuration-archived-row" key={label.id}>
              <span
                className="configuration-color"
                style={{ background: label.color }}
              />
              <span>
                <strong>{label.name}</strong>
                <small>{label.description || 'No description'}</small>
              </span>
              {canManage && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() =>
                    void run(() =>
                      updateTaskLabel(
                        props.context,
                        props.workspace.id,
                        label.id,
                        { archived: false },
                      ),
                    )
                  }
                >
                  <ArchiveRestore size={13} /> Restore
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      {!canManage && (
        <p className="settings-muted">
          Only Workspace Owners and Admins can change labels.
        </p>
      )}
    </SettingsArticle>
  );
}

function LabelRow({
  label,
  canManage,
  onSave,
  onArchive,
  onDelete,
}: {
  label: TaskLabel;
  canManage: boolean;
  onSave: (
    patch: Pick<TaskLabel, 'name' | 'color' | 'description'>,
  ) => Promise<void>;
  onArchive: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(label.color);
  const [description, setDescription] = useState(label.description);
  const dirty =
    name.trim() !== label.name ||
    color !== label.color ||
    description.trim() !== label.description;

  return (
    <div className="configuration-row label-configuration-row">
      <input
        className="configuration-color-input"
        aria-label={`${label.name} color`}
        type="color"
        disabled={!canManage}
        value={color}
        onChange={(event) => setColor(event.target.value.toUpperCase())}
      />
      <input
        aria-label={`${label.name} name`}
        disabled={!canManage}
        maxLength={120}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <input
        aria-label={`${label.name} description`}
        disabled={!canManage}
        maxLength={500}
        value={description}
        placeholder="No description"
        onChange={(event) => setDescription(event.target.value)}
      />
      {canManage && (
        <div className="configuration-row-actions">
          {dirty && (
            <button
              className="secondary-button"
              type="button"
              onClick={() => void onSave({ name, color, description })}
            >
              Save
            </button>
          )}
          <button
            className="icon-button"
            type="button"
            aria-label={`Archive ${label.name}`}
            onClick={() => void onArchive()}
          >
            <Archive size={14} />
          </button>
          <button
            className="icon-button danger-icon-button"
            type="button"
            aria-label={`Delete ${label.name}`}
            onClick={() => {
              if (window.confirm(`Delete ${label.name}?`)) void onDelete();
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
