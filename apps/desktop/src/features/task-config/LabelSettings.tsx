import { Archive, Pencil, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AppDialog } from '../../components/ui/AppDialog';
import { Button } from '../../components/ui/Button';
import { ColorSwatchPicker } from '../../components/ui/ColorSwatchPicker';
import { Input } from '../../components/ui/Input';
import { SettingsArticle } from '../settings/SettingsArticle';
import {
  SettingsAction,
  SettingsActionSeparator,
  SettingsActionsMenu,
  SettingsEmptyState,
  SettingsList,
  SettingsListCell,
  SettingsListRow,
} from '../settings/SettingsList';
import { errorMessage } from '../settings/utils';
import type { ApiContext } from '../workspace/api';
import type {
  TaskConfiguration,
  TaskLabel,
  Workspace,
} from '../workspace/types';
import { ArchivedConfigurationList } from './ArchivedConfigurationList';
import { ConfigurationSwatch } from './ConfigurationSwatch';
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskLabel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const active = props.configuration.labels.filter(
    (label) => !label.archived_at,
  );
  const archived = props.configuration.labels.filter(
    (label) => label.archived_at,
  );

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await createTaskLabel(props.context, props.workspace.id, {
        name: name.trim(),
        color,
        description: description.trim(),
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
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    }
  }

  return (
    <SettingsArticle
      className="configuration-settings"
      eyebrow="Workspace"
      title="Labels"
      description="Create a shared vocabulary for organizing work."
    >
      {error ? (
        <p className="settings-error configuration-message" role="alert">
          {error}
        </p>
      ) : null}
      <SettingsList
        ariaLabel="Active task labels"
        className="label-settings-grid"
        header={
          <>
            <SettingsListCell>Color</SettingsListCell>
            <SettingsListCell>Name</SettingsListCell>
            <SettingsListCell>Description</SettingsListCell>
            <SettingsListCell>
              <span className="sr-only">Actions</span>
            </SettingsListCell>
          </>
        }
      >
        {canManage ? (
          <form
            className="settings-list-row settings-list-create-row"
            role="listitem"
            aria-label="Create label"
            onSubmit={(event) => void create(event)}
          >
            <SettingsListCell className="settings-visual-cell">
              <ColorSwatchPicker
                ariaLabel="Choose new label color"
                disabled={saving}
                value={color}
                onChange={setColor}
              />
            </SettingsListCell>
            <SettingsListCell>
              <Input
                aria-label="Label name"
                required
                maxLength={120}
                value={name}
                placeholder="Label name"
                disabled={saving}
                onChange={(event) => setName(event.target.value)}
              />
            </SettingsListCell>
            <SettingsListCell>
              <Input
                aria-label="Label description"
                maxLength={500}
                value={description}
                placeholder="Optional description"
                disabled={saving}
                onChange={(event) => setDescription(event.target.value)}
              />
            </SettingsListCell>
            <SettingsListCell className="settings-list-actions-cell">
              <Button
                variant="primary"
                size="sm"
                type="submit"
                disabled={saving || !name.trim()}
              >
                {saving ? 'Adding…' : 'Add label'}
              </Button>
            </SettingsListCell>
          </form>
        ) : null}
        {active.length === 0 ? (
          <SettingsEmptyState
            title="No labels yet"
            description="Create a label to organize work across this Workspace."
          />
        ) : null}
        {active.map((label) =>
          editingId === label.id ? (
            <LabelEditRow
              key={label.id}
              label={label}
              onCancel={() => setEditingId(null)}
              onSave={async (patch) => {
                const saved = await run(() =>
                  updateTaskLabel(
                    props.context,
                    props.workspace.id,
                    label.id,
                    patch,
                  ),
                );
                if (saved) setEditingId(null);
              }}
            />
          ) : (
            <SettingsListRow key={label.id}>
              <SettingsListCell className="settings-visual-cell">
                <ConfigurationSwatch color={label.color} />
              </SettingsListCell>
              <SettingsListCell primary>{label.name}</SettingsListCell>
              <SettingsListCell className="settings-description-cell">
                {label.description || 'No description'}
              </SettingsListCell>
              <SettingsListCell className="settings-list-actions-cell">
                {canManage ? (
                  <SettingsActionsMenu label={`Actions for ${label.name}`}>
                    <SettingsAction
                      icon={<Pencil aria-hidden="true" size={14} />}
                      onClick={() => setEditingId(label.id)}
                    >
                      Edit
                    </SettingsAction>
                    <SettingsAction
                      icon={<Archive aria-hidden="true" size={14} />}
                      onClick={() =>
                        void run(() =>
                          updateTaskLabel(
                            props.context,
                            props.workspace.id,
                            label.id,
                            { archived: true },
                          ),
                        )
                      }
                    >
                      Archive
                    </SettingsAction>
                    <SettingsActionSeparator />
                    <SettingsAction
                      destructive
                      icon={<Trash2 aria-hidden="true" size={14} />}
                      onClick={() => setDeleteTarget(label)}
                    >
                      Delete
                    </SettingsAction>
                  </SettingsActionsMenu>
                ) : null}
              </SettingsListCell>
            </SettingsListRow>
          ),
        )}
      </SettingsList>
      <ArchivedConfigurationList
        ariaLabel="Archived task labels"
        canManage={canManage}
        className="label-archive-list"
        items={archived.map((label) => ({
          id: label.id,
          name: label.name,
          detail: label.description || 'No description',
          visual: <ConfigurationSwatch color={label.color} />,
        }))}
        onRestore={(labelId) =>
          run(() =>
            updateTaskLabel(props.context, props.workspace.id, labelId, {
              archived: false,
            }),
          )
        }
      />
      {!canManage ? (
        <p className="settings-muted">
          Only Workspace Owners and Admins can change labels.
        </p>
      ) : null}
      <AppDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        type="confirm"
        variant="danger"
        title={`Delete ${deleteTarget?.name ?? 'label'}?`}
        description="This permanently removes the label from every task. This cannot be undone."
        confirmLabel="Delete"
        loadingLabel="Deleting…"
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteTaskLabel(
            props.context,
            props.workspace.id,
            deleteTarget.id,
          );
          await props.onChanged();
        }}
      />
    </SettingsArticle>
  );
}

function LabelEditRow({
  label,
  onCancel,
  onSave,
}: {
  label: TaskLabel;
  onCancel: () => void;
  onSave: (
    patch: Pick<TaskLabel, 'name' | 'color' | 'description'>,
  ) => Promise<void>;
}) {
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(label.color);
  const [description, setDescription] = useState(label.description);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        color,
        description: description.trim(),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="settings-list-row settings-list-edit-row"
      role="listitem"
      aria-label={`Edit ${label.name}`}
      onSubmit={(event) => void submit(event)}
    >
      <SettingsListCell className="settings-visual-cell">
        <ColorSwatchPicker
          ariaLabel={`Change color for ${label.name}`}
          disabled={saving}
          value={color}
          onChange={setColor}
        />
      </SettingsListCell>
      <SettingsListCell>
        <Input
          autoFocus
          aria-label={`${label.name} name`}
          maxLength={120}
          disabled={saving}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </SettingsListCell>
      <SettingsListCell>
        <Input
          aria-label={`${label.name} description`}
          maxLength={500}
          disabled={saving}
          value={description}
          placeholder="No description"
          onChange={(event) => setDescription(event.target.value)}
        />
      </SettingsListCell>
      <SettingsListCell className="settings-edit-actions">
        <Button
          variant="text"
          size="sm"
          type="button"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          type="submit"
          disabled={saving || !name.trim()}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </SettingsListCell>
    </form>
  );
}
