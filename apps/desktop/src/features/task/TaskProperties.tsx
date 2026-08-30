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
  onPatch: (patch: TaskPatch) => Promise<void>;
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
  onPatch,
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

  function reveal(key: ExtendedPropertyKey) {
    setRevealed((current) => new Set(current).add(key));
    setFocusProperty(key);
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

        {canEdit && (
          <div className="add-property-row">
            <dt>Property</dt>
            <dd>
              <AddPropertyMenu
                properties={availableProperties}
                onSelect={reveal}
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Task update failed';
}
