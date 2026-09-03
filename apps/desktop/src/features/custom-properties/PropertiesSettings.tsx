import { Archive, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SettingsArticle } from '../settings/SettingsArticle';
import { LoadError } from '../settings/SettingsControls';
import {
  SettingsAction,
  SettingsActionSeparator,
  SettingsActionsMenu,
  SettingsEmptyState,
  SettingsList,
  SettingsListCell,
} from '../settings/SettingsList';
import {
  SettingsSortableProvider,
  SettingsSortableRow,
} from '../settings/SettingsSortable';
import { errorMessage } from '../settings/utils';
import type { ApiContext } from '../workspace/api';
import type { CustomPropertyDefinition, Workspace } from '../workspace/types';
import {
  deleteProperty,
  listProperties,
  listUndefinedProperties,
  reorderProperties,
  updateProperty,
} from './api';
import { PropertyEditorDialog } from './PropertyEditorDialog';

export function PropertiesSettings({
  context,
  workspace,
  createRequested = 0,
  onCreateRequestHandled,
  definePropertyName,
  onDefinePropertyClosed,
}: {
  context: ApiContext;
  workspace: Workspace;
  createRequested?: number;
  onCreateRequestHandled?: () => void;
  definePropertyName?: string;
  onDefinePropertyClosed?: () => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['custom-properties', workspace.id],
    queryFn: () => listProperties(context, workspace.id),
  });
  const canManage = workspace.role === 'owner' || workspace.role === 'admin';
  const routedDefineName = canManage ? definePropertyName : undefined;
  const undefinedQuery = useQuery({
    queryKey: ['undefined-properties', workspace.id],
    queryFn: () => listUndefinedProperties(context, workspace.id),
    enabled: canManage,
  });
  const [tab, setTab] = useState<'defined' | 'undefined'>(
    routedDefineName ? 'undefined' : 'defined',
  );
  const [creating, setCreating] = useState(createRequested > 0 && canManage);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<CustomPropertyDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [defineTarget, setDefineTarget] = useState(routedDefineName ?? null);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['custom-properties', workspace.id],
      }),
      queryClient.invalidateQueries({ queryKey: ['tasks', workspace.id] }),
      queryClient.invalidateQueries({ queryKey: ['task', workspace.id] }),
      queryClient.invalidateQueries({
        queryKey: ['undefined-properties', workspace.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ['task-undefined-properties', workspace.id],
      }),
    ]);
  }

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  if (query.isPending) {
    return (
      <SettingsArticle
        eyebrow="Workspace"
        title="Properties"
        description="Loading custom task properties…"
      >
        <div className="configuration-skeleton" aria-label="Loading settings">
          <span />
          <span />
          <span />
        </div>
      </SettingsArticle>
    );
  }
  if (query.error) {
    return (
      <SettingsArticle
        eyebrow="Workspace"
        title="Properties"
        description="Add custom fields for structured task information."
      >
        <LoadError error={query.error} onRetry={() => query.refetch()} />
      </SettingsArticle>
    );
  }

  const active = query.data.filter((property) => !property.archived_at);
  const archived = query.data.filter((property) => property.archived_at);
  const editing = query.data.find(({ id }) => id === editingId);

  return (
    <SettingsArticle
      className="configuration-settings"
      eyebrow="Workspace"
      title="Properties"
      description="Add custom fields for structured task information."
      action={
        canManage ? (
          <button
            className="primary-button"
            type="button"
            onClick={() => setCreating(true)}
          >
            <Plus aria-hidden="true" size={14} /> New property
          </button>
        ) : undefined
      }
    >
      {error ? (
        <p className="settings-error configuration-message" role="alert">
          {error}
        </p>
      ) : null}
      <div
        className="settings-segmented-tabs"
        role="tablist"
        aria-label="Property lists"
      >
        <button
          type="button"
          role="tab"
          aria-label="Defined"
          aria-selected={tab === 'defined'}
          onClick={() => setTab('defined')}
        >
          Defined
          <span>{query.data.length}</span>
        </button>
        {canManage ? (
          <button
            type="button"
            role="tab"
            aria-label="Undefined"
            aria-selected={tab === 'undefined'}
            onClick={() => setTab('undefined')}
          >
            Undefined
            <span>{undefinedQuery.data?.length ?? 0}</span>
          </button>
        ) : null}
      </div>
      {tab === 'defined' ? (
        <SettingsList
          ariaLabel="Custom properties"
          className="property-settings-grid"
          header={
            <>
              <SettingsListCell>
                <span className="sr-only">Order</span>
              </SettingsListCell>
              <SettingsListCell>Name</SettingsListCell>
              <SettingsListCell>Type</SettingsListCell>
              <SettingsListCell>Status</SettingsListCell>
              <SettingsListCell>
                <span className="sr-only">Actions</span>
              </SettingsListCell>
            </>
          }
        >
          {active.length === 0 ? (
            <SettingsEmptyState
              title="No custom properties yet"
              description="Create a property to add structured metadata to Tasks."
            />
          ) : null}
          <SettingsSortableProvider
            ids={active.map(({ id }) => id)}
            disabled={!canManage}
            onReorder={(ids) =>
              run(() => reorderProperties(context, workspace.id, ids)).then(
                () => undefined,
              )
            }
          >
            {active.map((property, index) => (
              <SettingsSortableRow
                key={property.id}
                id={property.id}
                index={index}
                label={property.name}
                disabled={!canManage}
              >
                <SettingsListCell primary>
                  <span title={property.description || property.name}>
                    {property.name}
                  </span>
                  {property.description ? (
                    <small>{property.description}</small>
                  ) : null}
                </SettingsListCell>
                <SettingsListCell>
                  {propertyTypeLabel(property.type)}
                </SettingsListCell>
                <SettingsListCell className="settings-status-text">
                  {property.usage_count === 0
                    ? 'Unused'
                    : `${property.usage_count} ${property.usage_count === 1 ? 'Task' : 'Tasks'}`}
                </SettingsListCell>
                <SettingsListCell className="settings-list-actions-cell">
                  {canManage ? (
                    <SettingsActionsMenu label={`Actions for ${property.name}`}>
                      <SettingsAction
                        icon={<Pencil aria-hidden="true" size={14} />}
                        onClick={() => setEditingId(property.id)}
                      >
                        Edit
                      </SettingsAction>
                      <SettingsAction
                        icon={<Archive aria-hidden="true" size={14} />}
                        onClick={() =>
                          void run(() =>
                            updateProperty(context, workspace.id, property.id, {
                              archived: true,
                            }),
                          )
                        }
                      >
                        Archive
                      </SettingsAction>
                      <SettingsActionSeparator />
                      <SettingsAction
                        destructive
                        icon={<Trash2 aria-hidden="true" size={14} />}
                        onClick={() => setDeleteTarget(property)}
                      >
                        Delete
                      </SettingsAction>
                    </SettingsActionsMenu>
                  ) : null}
                </SettingsListCell>
              </SettingsSortableRow>
            ))}
          </SettingsSortableProvider>
        </SettingsList>
      ) : (
        <UndefinedPropertiesList
          loading={undefinedQuery.isPending}
          error={undefinedQuery.error}
          properties={undefinedQuery.data ?? []}
          onRetry={() => void undefinedQuery.refetch()}
          onDefine={setDefineTarget}
        />
      )}

      {tab === 'defined' && archived.length > 0 ? (
        <section
          className="settings-archived-section"
          aria-label="Archived properties"
        >
          <h2>Archived</h2>
          {archived.map((property) => (
            <div className="settings-archived-row" key={property.id}>
              <span>
                <strong>{property.name}</strong>
                <small>{propertyTypeLabel(property.type)}</small>
              </span>
              {canManage ? (
                <SettingsActionsMenu label={`Actions for ${property.name}`}>
                  <SettingsAction
                    icon={<RotateCcw aria-hidden="true" size={14} />}
                    onClick={() =>
                      void run(() =>
                        updateProperty(context, workspace.id, property.id, {
                          archived: false,
                        }),
                      )
                    }
                  >
                    Restore
                  </SettingsAction>
                  <SettingsActionSeparator />
                  <SettingsAction
                    destructive
                    icon={<Trash2 aria-hidden="true" size={14} />}
                    onClick={() => setDeleteTarget(property)}
                  >
                    Delete
                  </SettingsAction>
                </SettingsActionsMenu>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {creating || editing || (canManage && defineTarget) ? (
        <PropertyEditorDialog
          context={context}
          workspaceId={workspace.id}
          property={editing}
          initialName={defineTarget ?? ''}
          defineExisting={Boolean(defineTarget)}
          undefinedNames={(undefinedQuery.data ?? []).map(({ name }) => name)}
          onDefineExisting={(name) => {
            setCreating(false);
            setDefineTarget(name);
            setTab('undefined');
          }}
          onClose={() => {
            setCreating(false);
            setEditingId(null);
            setDefineTarget(null);
            if (createRequested > 0) onCreateRequestHandled?.();
            if (defineTarget) onDefinePropertyClosed?.();
          }}
          onSaved={refresh}
        />
      ) : null}

      {deleteTarget ? (
        <PropertyDeleteDialog
          property={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDelete={() =>
            deleteProperty(
              context,
              workspace.id,
              deleteTarget.id,
              deleteTarget.name,
            ).then(refresh)
          }
        />
      ) : null}
    </SettingsArticle>
  );
}

function UndefinedPropertiesList({
  loading,
  error,
  properties,
  onRetry,
  onDefine,
}: {
  loading: boolean;
  error: Error | null;
  properties: { name: string; task_count: number }[];
  onRetry: () => void;
  onDefine: (name: string) => void;
}) {
  return (
    <SettingsList
      ariaLabel="Undefined properties"
      className="undefined-property-settings-grid"
      header={
        <>
          <SettingsListCell>Name</SettingsListCell>
          <SettingsListCell>Found in</SettingsListCell>
          <SettingsListCell>
            <span className="sr-only">Actions</span>
          </SettingsListCell>
        </>
      }
    >
      {error ? (
        <div className="settings-list-empty">
          <LoadError error={error} onRetry={onRetry} />
        </div>
      ) : loading ? (
        <SettingsEmptyState
          title="Scanning Task Markdown…"
          description="Checking top-level fields across this Workspace."
        />
      ) : properties.length === 0 ? (
        <SettingsEmptyState
          title="No undefined properties"
          description="Every custom Markdown field is either defined or intentionally absent."
        />
      ) : (
        properties.map((property) => (
          <div
            className="settings-list-row"
            role="listitem"
            key={property.name}
          >
            <SettingsListCell primary>{property.name}</SettingsListCell>
            <SettingsListCell className="settings-status-text">
              {property.task_count}{' '}
              {property.task_count === 1 ? 'Task' : 'Tasks'}
            </SettingsListCell>
            <SettingsListCell className="settings-list-actions-cell">
              <button
                className="text-button"
                type="button"
                aria-label={`Define ${property.name}`}
                onClick={() => onDefine(property.name)}
              >
                Define
              </button>
            </SettingsListCell>
          </div>
        ))
      )}
    </SettingsList>
  );
}

function PropertyDeleteDialog({
  property,
  onClose,
  onDelete,
}: {
  property: CustomPropertyDefinition;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      saving ||
      confirmation !== property.name ||
      !window.confirm(`Permanently delete ${property.name}?`)
    )
      return;
    setSaving(true);
    setError(null);
    try {
      await onDelete();
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="configuration-dialog"
      aria-label={`Delete ${property.name}`}
    >
      <form onSubmit={(event) => void submit(event)}>
        <header>
          <div>
            <span className="dialog-step-label">Permanent action</span>
            <h2>Delete {property.name}</h2>
            <p>
              {property.usage_count === 0
                ? 'No Tasks currently use this property.'
                : `${property.usage_count} ${property.usage_count === 1 ? 'Task uses' : 'Tasks use'} this property.`}{' '}
              Values are removed, the Markdown field is cleaned up, and the name
              becomes available again.
            </p>
          </div>
        </header>
        <label className="settings-field">
          Type {property.name} to confirm
          <input
            value={confirmation}
            disabled={saving}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        {error ? (
          <p className="settings-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer>
          <button
            className="secondary-button"
            type="button"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="danger-button"
            type="submit"
            disabled={saving || confirmation !== property.name}
          >
            {saving ? 'Deleting…' : 'Delete property'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function propertyTypeLabel(type: CustomPropertyDefinition['type']) {
  if (type === 'single_select') return 'Single select';
  if (type === 'multi_select') return 'Multi select';
  return type === 'url' ? 'URL' : `${type[0].toUpperCase()}${type.slice(1)}`;
}
