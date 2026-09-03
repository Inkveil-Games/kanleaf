import { useEffect, useRef, useState } from 'react';
import { Select } from '../../components/ui/Select';
import type {
  Project,
  ProjectCycle,
  ProjectModule,
  Task,
  TaskAssignee,
  TaskLabel,
  TaskPatch,
  TaskPriority,
  TaskState,
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
  isExtendedProperty,
  selectableStates,
  selectableTypes,
  type ExtendedPropertyKey,
  type PropertyKey,
} from './taskPropertyModel';

interface TaskPropertiesProps {
  task: Task;
  projects: Project[];
  states: TaskState[];
  taskTypes: TaskType[];
  labels: TaskLabel[];
  cycles: ProjectCycle[];
  modules: ProjectModule[];
  assigneeCandidates: TaskAssignee[];
  taskCandidates: Task[];
  canEdit: boolean;
  canManageProperties: boolean;
  onPatch: (patch: TaskPatch) => Promise<void>;
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
  states,
  taskTypes,
  labels,
  cycles,
  modules,
  assigneeCandidates,
  taskCandidates,
  canEdit,
  canManageProperties,
  onPatch,
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
  const [savingProperties, setSavingProperties] = useState<Set<PropertyKey>>(
    () => new Set(),
  );
  const [failedProperties, setFailedProperties] = useState<Set<PropertyKey>>(
    () => new Set(),
  );
  const [error, setError] = useState<string | null>(null);
  const [revealedCustom, setRevealedCustom] = useState<Set<string>>(
    () => new Set(),
  );
  const [savingCustom, setSavingCustom] = useState<Set<string>>(
    () => new Set(),
  );
  const listRef = useRef<HTMLDListElement>(null);
  const savingRef = useRef<Set<PropertyKey>>(new Set());
  const activeProject = projects.find(({ id }) => id === task.project_id);

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
  const showCustomSection = Boolean(
    customPropertiesLoading ||
    undefinedPropertiesLoading ||
    customPropertiesError ||
    undefinedPropertiesError ||
    visibleCustomProperties.length > 0 ||
    undefinedProperties.length > 0,
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
    setError(null);
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
      setError(errorMessage(caught));
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
      savingRef.current.has(key) ||
      failedProperties.has(key) ||
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

  async function patchProperty(
    key: PropertyKey,
    patch: TaskPatch,
    hasNextValue = true,
  ) {
    setError(null);
    setFailedProperties((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    savingRef.current.add(key);
    setSavingProperties(new Set(savingRef.current));
    try {
      await onPatch(patch);
      if (isExtendedProperty(key)) {
        setRevealed((current) => {
          const next = new Set(current);
          if (hasNextValue) next.add(key);
          else next.delete(key);
          return next;
        });
      }
    } catch (caught) {
      setFailedProperties((current) => new Set(current).add(key));
      if (isExtendedProperty(key)) {
        setRevealed((current) => new Set(current).add(key));
      }
      setError(errorMessage(caught));
    } finally {
      savingRef.current.delete(key);
      setSavingProperties(new Set(savingRef.current));
    }
  }

  function disabled(key: PropertyKey) {
    return !canEdit || savingProperties.has(key);
  }

  return (
    <section className="task-property-area" aria-label="Task properties">
      <dl ref={listRef} className="task-properties">
        <PropertyRow label="State" propertyKey="state">
          <Select
            ariaLabel="State"
            value={task.state.id}
            disabled={disabled('state')}
            options={selectableStates(states, task).map((state) => ({
              value: state.id,
              label: state.name,
            }))}
            onValueChange={(value) =>
              void patchProperty('state', { state_id: value })
            }
          />
        </PropertyRow>

        <PropertyRow label="Assignee" propertyKey="assignees">
          <MultiValuePicker
            label="Edit assignees"
            emptyLabel="Unassigned"
            readOnly={!canEdit}
            saving={savingProperties.has('assignees')}
            values={task.assignees.map(({ user_id }) => user_id)}
            options={assigneeCandidates.map((member) => ({
              id: member.user_id,
              label: member.display_name,
            }))}
            onChange={(assigneeIds) =>
              patchProperty('assignees', { assignee_ids: assigneeIds })
            }
          />
        </PropertyRow>

        <PropertyRow label="Priority" propertyKey="priority">
          <Select
            ariaLabel="Priority"
            value={task.priority}
            disabled={disabled('priority')}
            options={[
              { value: 'none', label: 'No priority' },
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
              { value: 'urgent', label: 'Urgent' },
            ]}
            onValueChange={(value) =>
              void patchProperty('priority', {
                priority: value as TaskPriority,
              })
            }
          />
        </PropertyRow>

        <PropertyRow label="Due date" propertyKey="due-date">
          <input
            aria-label="Due date"
            type="date"
            disabled={disabled('due-date')}
            value={task.due_date ?? ''}
            onChange={(event) =>
              void patchProperty('due-date', {
                due_date: event.target.value || null,
              })
            }
          />
        </PropertyRow>

        {isVisible('type') && (
          <PropertyRow label="Type" propertyKey="type">
            <Select
              ariaLabel="Task type"
              value={task.task_type.id}
              disabled={disabled('type')}
              options={selectableTypes(taskTypes, task).map((taskType) => ({
                value: taskType.id,
                label: taskType.name,
              }))}
              onValueChange={(value) =>
                void patchProperty('type', { task_type_id: value })
              }
            />
          </PropertyRow>
        )}

        {isVisible('project') && (
          <PropertyRow
            label="Project"
            propertyKey="project"
            onLeaveEmpty={() => dismissEmpty('project')}
          >
            <Select
              ariaLabel="Project"
              value={task.project_id ?? ''}
              disabled={disabled('project')}
              options={[
                { value: '', label: 'Inbox' },
                ...projects.map((project) => ({
                  value: project.id,
                  label: project.name,
                })),
              ]}
              onValueChange={(value) => {
                const projectId = value || null;
                const cleanup = window.confirm(
                  'Move this Task and remove incompatible assignees, type, hierarchy, Cycle, or Modules if needed?',
                );
                if (!cleanup) return;
                void patchProperty(
                  'project',
                  { project_id: projectId, cleanup_invalid: true },
                  Boolean(projectId),
                );
              }}
            />
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
              saving={savingProperties.has('labels')}
              values={task.labels.map(({ id }) => id)}
              options={labels
                .filter(
                  ({ id, archived_at }) =>
                    !archived_at ||
                    task.labels.some((label) => label.id === id),
                )
                .map((label) => ({ id: label.id, label: label.name }))}
              onChange={(labelIds) =>
                patchProperty(
                  'labels',
                  { label_ids: labelIds },
                  labelIds.length > 0,
                )
              }
            />
          </PropertyRow>
        )}

        {isVisible('start-date') && (
          <PropertyRow
            label="Start date"
            propertyKey="start-date"
            onLeaveEmpty={() => dismissEmpty('start-date')}
          >
            <input
              aria-label="Start date"
              type="date"
              disabled={disabled('start-date')}
              value={task.start_date ?? ''}
              onChange={(event) => {
                const value = event.target.value || null;
                void patchProperty(
                  'start-date',
                  { start_date: value },
                  Boolean(value),
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
            <input
              aria-label="Estimate"
              type="number"
              min={0}
              disabled={disabled('estimate')}
              value={task.estimate ?? ''}
              placeholder="No estimate"
              onChange={(event) => {
                const value = event.target.value
                  ? Number(event.target.value)
                  : null;
                void patchProperty(
                  'estimate',
                  { estimate: value },
                  value !== null,
                );
              }}
            />
          </PropertyRow>
        )}

        {isVisible('parent') && (
          <PropertyRow
            label="Parent"
            propertyKey="parent"
            onLeaveEmpty={() => dismissEmpty('parent')}
          >
            <Select
              ariaLabel="Parent task"
              disabled={disabled('parent')}
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
                void patchProperty(
                  'parent',
                  { parent_id: value || null },
                  Boolean(value),
                )
              }
            />
          </PropertyRow>
        )}

        {isVisible('cycle') && (
          <PropertyRow
            label="Cycle"
            propertyKey="cycle"
            onLeaveEmpty={() => dismissEmpty('cycle')}
          >
            <Select
              ariaLabel="Cycle"
              value={task.cycle?.id ?? ''}
              disabled={disabled('cycle')}
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
                void patchProperty(
                  'cycle',
                  { cycle_id: value || null },
                  Boolean(value),
                )
              }
            />
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
              saving={savingProperties.has('modules')}
              values={task.modules.map(({ id }) => id)}
              options={[
                ...task.modules.filter(
                  (assigned) =>
                    !modules.some((module) => module.id === assigned.id),
                ),
                ...modules,
              ].map((module) => ({ id: module.id, label: module.name }))}
              onChange={(moduleIds) =>
                patchProperty(
                  'modules',
                  { module_ids: moduleIds },
                  moduleIds.length > 0,
                )
              }
            />
          </PropertyRow>
        )}

        {showCustomSection ? (
          <div className="task-property-section-heading">
            <dt>Custom</dt>
            <dd>Workspace properties</dd>
          </div>
        ) : null}

        {customPropertiesLoading || undefinedPropertiesLoading ? (
          <PropertyRow label="Custom" propertyKey="custom-loading">
            <span className="property-readonly-value">Loading properties…</span>
          </PropertyRow>
        ) : null}

        {customPropertiesError || undefinedPropertiesError ? (
          <PropertyRow label="Custom" propertyKey="custom-error">
            <span className="custom-property-load-error" role="alert">
              {customPropertiesError ?? undefinedPropertiesError}
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  if (customPropertiesError) onRetryCustomProperties();
                  if (undefinedPropertiesError) onRetryUndefinedProperties();
                }}
              >
                Try again
              </button>
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
                {property.archived_at ? (
                  <span className="property-readonly-value">
                    {formatCustomValue(property, value)}
                    <span className="settings-status-badge">Archived</span>
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
                  <button
                    className="icon-button custom-property-clear"
                    type="button"
                    aria-label={`Clear ${property.name}`}
                    disabled={savingCustom.has(property.id)}
                    onClick={() => void changeCustomProperty(property.id)}
                  >
                    ×
                  </button>
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
              {canManageProperties ? (
                <button
                  className="text-button"
                  type="button"
                  aria-label={`Define ${property.name}`}
                  onClick={() => void onDefineProperty(property.name)}
                >
                  Define property
                </button>
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
      {error && (
        <p className="detail-error" role="alert">
          {error}
        </p>
      )}
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
      <label className="custom-checkbox-property">
        <input
          aria-label={property.name}
          type="checkbox"
          disabled={disabled}
          checked={value === true}
          onChange={(event) => void onChange(event.target.checked)}
        />
        {value === true ? 'Checked' : 'Unchecked'}
      </label>
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
    <input
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
