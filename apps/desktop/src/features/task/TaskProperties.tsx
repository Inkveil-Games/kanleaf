import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AppDialog } from '../../components/ui/AppDialog';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { IconButton } from '../../components/ui/IconButton';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import type {
  Project,
  ProjectCycle,
  ProjectModule,
  Task,
  TaskLabel,
  TaskPatch,
  TaskType,
  CustomPropertyDefinition,
  TaskCustomPropertyValue,
  UndefinedTaskProperty,
} from '../workspace/types';
import {
  AddPropertyMenu,
  MultiValuePicker,
  PropertyRow,
} from './TaskPropertyControls';
import {
  EXTENDED_PROPERTIES,
  hasPropertyValue,
  isPinnedProperty,
  selectableTypes,
  type ExtendedPropertyKey,
} from './taskPropertyModel';
import type { TaskPropertyEditing } from './useTaskPropertyEditing';

interface TaskPropertiesProps {
  task: Task;
  projects: Project[];
  taskTypes: TaskType[];
  labels: TaskLabel[];
  cycles: ProjectCycle[];
  modules: ProjectModule[];
  taskCandidates: Task[];
  canEdit: boolean;
  canManageProperties: boolean;
  editing: TaskPropertyEditing;
  customProperties: CustomPropertyDefinition[];
  customPropertiesLoading: boolean;
  customPropertiesError: string | null;
  onRetryCustomProperties: () => void;
  undefinedProperties: UndefinedTaskProperty[];
  undefinedPropertiesLoading: boolean;
  undefinedPropertiesError: string | null;
  onRetryUndefinedProperties: () => void;
  onCustomPropertyChange: (
    propertyId: string,
    value?: TaskCustomPropertyValue['value'],
  ) => Promise<void>;
  onDefineProperty: (name: string) => Promise<void>;
}

export function TaskProperties({
  task,
  projects,
  taskTypes,
  labels,
  cycles,
  modules,
  taskCandidates,
  canEdit,
  canManageProperties,
  editing,
  customProperties,
  customPropertiesLoading,
  customPropertiesError,
  onRetryCustomProperties,
  undefinedProperties,
  undefinedPropertiesLoading,
  undefinedPropertiesError,
  onRetryUndefinedProperties,
  onCustomPropertyChange,
  onDefineProperty,
}: TaskPropertiesProps) {
  const [revealed, setRevealed] = useState<Set<ExtendedPropertyKey>>(
    () => new Set(),
  );
  const [focusProperty, setFocusProperty] =
    useState<ExtendedPropertyKey | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);
  const [revealedCustom, setRevealedCustom] = useState<Set<string>>(
    () => new Set(),
  );
  const [savingCustom, setSavingCustom] = useState<Set<string>>(
    () => new Set(),
  );
  const [pendingProjectId, setPendingProjectId] = useState<
    string | null | undefined
  >(undefined);
  const listRef = useRef<HTMLDListElement>(null);
  const activeProject = projects.find(({ id }) => id === task.project_id);
  const editableProjects = projects.filter(
    ({ effective_role }) =>
      effective_role === 'admin' || effective_role === 'contributor',
  );

  useEffect(() => {
    if (!focusProperty) return;
    const frame = requestAnimationFrame(() => {
      const row = listRef.current?.querySelector<HTMLElement>(
        `[data-task-property="${focusProperty}"]`,
      );
      row?.querySelector<HTMLElement>('button, input')?.focus();
      setFocusProperty(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusProperty]);

  function isVisible(key: ExtendedPropertyKey) {
    return revealed.has(key) || hasPropertyValue(task, key);
  }

  function isAvailable(key: ExtendedPropertyKey) {
    if (key === 'cycle') return Boolean(activeProject?.cycles_enabled);
    if (key === 'modules') return Boolean(activeProject?.modules_enabled);
    return true;
  }

  const availableProperties = EXTENDED_PROPERTIES.filter(
    ({ key }) => isAvailable(key) && !isVisible(key),
  );
  const customValues = new Map(
    (task.custom_properties ?? []).map((value) => [
      value.property_id,
      value.value,
    ]),
  );
  const visibleCustomProperties = customProperties.filter(
    (property) =>
      customValues.has(property.id) ||
      (!property.archived_at && revealedCustom.has(property.id)),
  );
  const availableCustomProperties = customProperties.filter(
    (property) =>
      !property.archived_at &&
      !customValues.has(property.id) &&
      !revealedCustom.has(property.id),
  );
  function reveal(key: ExtendedPropertyKey) {
    setRevealed((current) => new Set(current).add(key));
    setFocusProperty(key);
  }

  function revealCustom(propertyId: string) {
    setRevealedCustom((current) => new Set(current).add(propertyId));
    if (
      customProperties.find(({ id }) => id === propertyId)?.type === 'checkbox'
    ) {
      void changeCustomProperty(propertyId, false);
    }
  }

  async function changeCustomProperty(
    propertyId: string,
    value?: TaskCustomPropertyValue['value'],
  ): Promise<boolean> {
    setCustomError(null);
    setSavingCustom((current) => new Set(current).add(propertyId));
    try {
      await onCustomPropertyChange(propertyId, value);
      if (value === undefined) {
        setRevealedCustom((current) => {
          const next = new Set(current);
          next.delete(propertyId);
          return next;
        });
      }
      return true;
    } catch (caught) {
      setCustomError(errorMessage(caught));
      setRevealedCustom((current) => new Set(current).add(propertyId));
      return false;
    } finally {
      setSavingCustom((current) => {
        const next = new Set(current);
        next.delete(propertyId);
        return next;
      });
    }
  }

  function dismissEmpty(key: ExtendedPropertyKey) {
    if (
      editing.savingProperties.has(key) ||
      editing.failedProperties.has(key) ||
      hasPropertyValue(task, key)
    ) {
      return;
    }
    setRevealed((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }

  async function patchExtendedProperty(
    key: ExtendedPropertyKey,
    patch: TaskPatch,
    hasNextValue = true,
    rethrow = false,
  ) {
    try {
      const saved = await editing.patchProperty(key, patch, rethrow);
      setRevealed((current) => {
        const next = new Set(current);
        if (saved && !hasNextValue) next.delete(key);
        else next.add(key);
        return next;
      });
      return saved;
    } catch (caught) {
      setRevealed((current) => new Set(current).add(key));
      throw caught;
    }
  }

  return (
    <section className="task-property-area" aria-label="Task properties">
      <h2>Properties</h2>
      <dl ref={listRef} className="task-properties">
        {isVisible('type') && (
          <PropertyRow label="Type" propertyKey="type">
            {canEdit ? (
              <Select
                ariaLabel="Task type"
                value={task.task_type.id}
                disabled={editing.disabled('type')}
                options={selectableTypes(taskTypes, task).map((taskType) => ({
                  value: taskType.id,
                  label: taskType.name,
                }))}
                onValueChange={(value) =>
                  void patchExtendedProperty('type', { task_type_id: value })
                }
              />
            ) : (
              <span className="property-readonly-value">
                {task.task_type.name}
              </span>
            )}
          </PropertyRow>
        )}

        {isVisible('project') && (
          <PropertyRow
            label="Project"
            propertyKey="project"
            onLeaveEmpty={() => dismissEmpty('project')}
          >
            {canEdit ? (
              <Select
                ariaLabel="Project"
                value={task.project_id ?? ''}
                disabled={editing.disabled('project')}
                options={[
                  { value: '', label: 'Inbox' },
                  ...editableProjects.map((project) => ({
                    value: project.id,
                    label: project.name,
                  })),
                ]}
                onValueChange={(value) => setPendingProjectId(value || null)}
              />
            ) : (
              <span className="property-readonly-value">
                {activeProject?.name ?? 'Inbox'}
              </span>
            )}
          </PropertyRow>
        )}

        {isVisible('labels') && (
          <PropertyRow
            label="Labels"
            propertyKey="labels"
            onLeaveEmpty={() => dismissEmpty('labels')}
          >
            <MultiValuePicker
              label="Edit labels"
              emptyLabel="No labels"
              readOnly={!canEdit}
              saving={editing.savingProperties.has('labels')}
              values={task.labels.map(({ id }) => id)}
              options={labels
                .filter(
                  ({ id, archived_at }) =>
                    !archived_at ||
                    task.labels.some((label) => label.id === id),
                )
                .map((label) => ({ id: label.id, label: label.name }))}
              onChange={async (labelIds) => {
                await patchExtendedProperty(
                  'labels',
                  { label_ids: labelIds },
                  labelIds.length > 0,
                );
              }}
            />
          </PropertyRow>
        )}

        {isVisible('estimate') && (
          <PropertyRow
            label="Estimate"
            propertyKey="estimate"
            onLeaveEmpty={() => dismissEmpty('estimate')}
          >
            {canEdit ? (
              <Input
                aria-label="Estimate"
                type="number"
                min={0}
                disabled={editing.disabled('estimate')}
                value={task.estimate ?? ''}
                placeholder="No estimate"
                onChange={(event) => {
                  const value = event.target.value
                    ? Number(event.target.value)
                    : null;
                  void patchExtendedProperty(
                    'estimate',
                    { estimate: value },
                    value !== null,
                  );
                }}
              />
            ) : (
              <span className="property-readonly-value">
                {task.estimate ?? 'No estimate'}
              </span>
            )}
          </PropertyRow>
        )}

        {isVisible('parent') && (
          <PropertyRow
            label="Parent"
            propertyKey="parent"
            onLeaveEmpty={() => dismissEmpty('parent')}
          >
            {canEdit ? (
              <Select
                ariaLabel="Parent task"
                disabled={editing.disabled('parent')}
                value={task.parent?.id ?? ''}
                options={[
                  { value: '', label: 'No parent' },
                  ...taskCandidates
                    .filter(
                      (candidate) =>
                        candidate.id !== task.id &&
                        candidate.project_id === task.project_id,
                    )
                    .map((candidate) => ({
                      value: candidate.id,
                      label: `${candidate.reference} · ${candidate.title}`,
                    })),
                ]}
                onValueChange={(value) =>
                  void patchExtendedProperty(
                    'parent',
                    { parent_id: value || null },
                    Boolean(value),
                  )
                }
              />
            ) : (
              <span className="property-readonly-value">
                {task.parent
                  ? `${task.parent.reference} · ${task.parent.title}`
                  : 'No parent'}
              </span>
            )}
          </PropertyRow>
        )}

        {isVisible('cycle') && (
          <PropertyRow
            label="Cycle"
            propertyKey="cycle"
            onLeaveEmpty={() => dismissEmpty('cycle')}
          >
            {canEdit ? (
              <Select
                ariaLabel="Cycle"
                value={task.cycle?.id ?? ''}
                disabled={editing.disabled('cycle')}
                options={[
                  { value: '', label: 'No Cycle' },
                  ...(task.cycle &&
                  !cycles.some(({ id }) => id === task.cycle?.id)
                    ? [{ value: task.cycle.id, label: task.cycle.name }]
                    : []),
                  ...cycles
                    .filter(
                      (cycle) =>
                        cycle.status !== 'completed' ||
                        cycle.id === task.cycle?.id,
                    )
                    .map((cycle) => ({
                      value: cycle.id,
                      label: `${cycle.name}${cycle.status === 'completed' ? ' · Completed' : ''}`,
                    })),
                ]}
                onValueChange={(value) =>
                  void patchExtendedProperty(
                    'cycle',
                    { cycle_id: value || null },
                    Boolean(value),
                  )
                }
              />
            ) : (
              <span className="property-readonly-value">
                {task.cycle?.name ?? 'No Cycle'}
              </span>
            )}
          </PropertyRow>
        )}

        {isVisible('modules') && (
          <PropertyRow
            label="Modules"
            propertyKey="modules"
            onLeaveEmpty={() => dismissEmpty('modules')}
          >
            <MultiValuePicker
              label="Edit Modules"
              emptyLabel="No Modules"
              readOnly={!canEdit}
              saving={editing.savingProperties.has('modules')}
              values={task.modules.map(({ id }) => id)}
              options={[
                ...task.modules.filter(
                  (assigned) =>
                    !modules.some((module) => module.id === assigned.id),
                ),
                ...modules,
              ].map((module) => ({ id: module.id, label: module.name }))}
              onChange={async (moduleIds) => {
                await patchExtendedProperty(
                  'modules',
                  { module_ids: moduleIds },
                  moduleIds.length > 0,
                );
              }}
            />
          </PropertyRow>
        )}

        {customPropertiesLoading || undefinedPropertiesLoading ? (
          <PropertyRow label="Properties" propertyKey="custom-loading">
            <span className="property-readonly-value">Loading properties…</span>
          </PropertyRow>
        ) : null}

        {customPropertiesError || undefinedPropertiesError ? (
          <PropertyRow label="Properties" propertyKey="custom-error">
            <span className="custom-property-load-error" role="alert">
              {customPropertiesError ?? undefinedPropertiesError}
              <Button
                variant="text"
                size="sm"
                type="button"
                onClick={() => {
                  if (customPropertiesError) onRetryCustomProperties();
                  if (undefinedPropertiesError) onRetryUndefinedProperties();
                }}
              >
                Try again
              </Button>
            </span>
          </PropertyRow>
        ) : null}

        {visibleCustomProperties.map((property) => {
          const value = customValues.get(property.id);
          return (
            <PropertyRow
              key={property.id}
              label={property.name}
              propertyKey={`custom-${property.id}`}
            >
              <div className="custom-property-control">
                {!canEdit || property.archived_at ? (
                  <span className="property-readonly-value">
                    {formatCustomValue(property, value)}
                    {property.archived_at ? (
                      <span className="settings-status-badge">Archived</span>
                    ) : null}
                  </span>
                ) : (
                  <CustomPropertyInput
                    property={property}
                    value={value}
                    disabled={!canEdit || savingCustom.has(property.id)}
                    onChange={(nextValue) =>
                      changeCustomProperty(property.id, nextValue)
                    }
                  />
                )}
                {canEdit && value !== undefined ? (
                  <IconButton
                    className="custom-property-clear"
                    variant="ghost"
                    size="sm"
                    type="button"
                    aria-label={`Clear ${property.name}`}
                    disabled={savingCustom.has(property.id)}
                    onClick={() => void changeCustomProperty(property.id)}
                  >
                    <X aria-hidden="true" size={13} />
                  </IconButton>
                ) : null}
              </div>
            </PropertyRow>
          );
        })}

        {undefinedProperties.map((property) => (
          <PropertyRow
            key={property.name}
            label={property.name}
            propertyKey={`undefined-${property.name}`}
          >
            <div className="undefined-property-value">
              <code>{formatUndefinedValue(property.value)}</code>
              <span className="settings-status-badge">Undefined</span>
              {canEdit && canManageProperties ? (
                <Button
                  variant="text"
                  size="sm"
                  type="button"
                  aria-label={`Define ${property.name}`}
                  onClick={() => void onDefineProperty(property.name)}
                >
                  Define property
                </Button>
              ) : null}
            </div>
          </PropertyRow>
        ))}

        {canEdit && (
          <div className="add-property-row">
            <dt>Property</dt>
            <dd>
              <AddPropertyMenu
                properties={availableProperties}
                customProperties={availableCustomProperties.map((property) => ({
                  key: property.id,
                  label: property.name,
                }))}
                onSelect={reveal}
                onSelectCustom={revealCustom}
              />
            </dd>
          </div>
        )}
      </dl>
      {(editing.error && !isPinnedProperty(editing.error.key)) ||
      customError ? (
        <p className="detail-error" role="alert">
          {editing.error && !isPinnedProperty(editing.error.key)
            ? editing.error.message
            : customError}
        </p>
      ) : null}
      <AppDialog
        open={pendingProjectId !== undefined}
        onOpenChange={(open) => {
          if (!open) setPendingProjectId(undefined);
        }}
        type="confirm"
        variant="warning"
        title="Move this Task?"
        description="Incompatible assignees, type, hierarchy, Cycle, or Modules will be removed."
        confirmLabel="Move Task"
        loadingLabel="Moving…"
        onConfirm={() => {
          if (pendingProjectId === undefined) return;
          return patchExtendedProperty(
            'project',
            { project_id: pendingProjectId, cleanup_invalid: true },
            Boolean(pendingProjectId),
            true,
          );
        }}
      />
    </section>
  );
}

function CustomPropertyInput({
  property,
  value,
  disabled,
  onChange,
}: {
  property: CustomPropertyDefinition;
  value: TaskCustomPropertyValue['value'] | undefined;
  disabled: boolean;
  onChange: (
    value?: TaskCustomPropertyValue['value'],
  ) => Promise<boolean | void>;
}) {
  if (property.type === 'checkbox') {
    return (
      <div className="custom-checkbox-property">
        <Checkbox
          aria-label={property.name}
          disabled={disabled}
          checked={value === true}
          onCheckedChange={(checked) => void onChange(checked)}
        />
        {value === true ? 'Checked' : 'Unchecked'}
      </div>
    );
  }
  if (property.type === 'single_select') {
    return (
      <Select
        ariaLabel={property.name}
        disabled={disabled}
        value={typeof value === 'string' ? value : ''}
        options={[
          { value: '', label: 'None' },
          ...property.options
            .filter((option) => !option.archived_at || option.id === value)
            .map((option) => ({ value: option.id, label: option.name })),
        ]}
        onValueChange={(next) => void onChange(next || undefined)}
      />
    );
  }
  if (property.type === 'multi_select') {
    const values = Array.isArray(value) ? value : [];
    return (
      <MultiValuePicker
        label={`Edit ${property.name}`}
        emptyLabel="None"
        readOnly={disabled}
        saving={disabled}
        values={values}
        options={property.options
          .filter((option) => !option.archived_at || values.includes(option.id))
          .map((option) => ({ id: option.id, label: option.name }))}
        onChange={async (next) => {
          await onChange(next.length > 0 ? next : undefined);
        }}
      />
    );
  }
  return (
    <CustomScalarInput
      key={JSON.stringify(value)}
      property={property}
      value={value}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

function CustomScalarInput({
  property,
  value,
  disabled,
  onChange,
}: {
  property: CustomPropertyDefinition;
  value: TaskCustomPropertyValue['value'] | undefined;
  disabled: boolean;
  onChange: (
    value?: TaskCustomPropertyValue['value'],
  ) => Promise<boolean | void>;
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  return (
    <Input
      aria-label={property.name}
      type={
        property.type === 'number'
          ? 'number'
          : property.type === 'date'
            ? 'date'
            : property.type === 'url'
              ? 'url'
              : 'text'
      }
      disabled={disabled}
      value={draft}
      placeholder={`No ${property.name.toLocaleLowerCase()}`}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(value === undefined ? '' : String(value));
          event.currentTarget.blur();
        }
      }}
      onBlur={() => {
        const saved = !draft
          ? onChange()
          : property.type === 'number'
            ? onChange(Number(draft))
            : draft !== value
              ? onChange(draft)
              : Promise.resolve(true);
        void saved.then((success) => {
          if (success === false) {
            setDraft(value === undefined ? '' : String(value));
          }
        });
      }}
    />
  );
}

function formatCustomValue(
  property: CustomPropertyDefinition,
  value: TaskCustomPropertyValue['value'] | undefined,
) {
  if (value === undefined) return 'None';
  if (property.type === 'checkbox') return value ? 'Checked' : 'Unchecked';
  if (property.type === 'single_select') {
    return (
      property.options.find((option) => option.id === value)?.name ??
      'Unknown option'
    );
  }
  if (property.type === 'multi_select' && Array.isArray(value)) {
    return value
      .map(
        (id) =>
          property.options.find((option) => option.id === id)?.name ??
          'Unknown option',
      )
      .join(', ');
  }
  return String(value);
}

function formatUndefinedValue(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Task update failed';
}
