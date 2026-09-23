import type { ReactNode } from 'react';
import { Select } from '../../components/ui/Select';
import type { Task, TaskAssignee, TaskState } from '../workspace/types';
import { MultiValuePicker, TaskDateControl } from './TaskPropertyControls';
import {
  TASK_PRIORITY_OPTIONS,
  isPinnedProperty,
  priorityLabel,
  selectableStates,
} from './taskPropertyModel';
import { PINNED_PROPERTIES } from './taskPropertyPresentation';
import { TaskPropertyIcon } from './TaskPropertyIcon';
import { PriorityIcon, StateIcon } from './TaskValueIcon';
import type { TaskPropertyEditing } from './useTaskPropertyEditing';

interface TaskPinnedPropertiesProps {
  task: Task;
  states: TaskState[];
  assigneeCandidates: TaskAssignee[];
  canEdit: boolean;
  editing: TaskPropertyEditing;
}

export function TaskPinnedProperties({
  task,
  states,
  assigneeCandidates,
  canEdit,
  editing,
}: TaskPinnedPropertiesProps) {
  return (
    <section
      className="task-pinned-property-area"
      aria-label="Pinned task properties"
    >
      <div className="task-pinned-properties">
        {PINNED_PROPERTIES.map((property) => (
          <PinnedProperty
            key={property.key}
            property={property}
            task={task}
            states={states}
            assigneeCandidates={assigneeCandidates}
            canEdit={canEdit}
            editing={editing}
          />
        ))}
      </div>
      {editing.error && isPinnedProperty(editing.error.key) ? (
        <p className="detail-error" role="alert">
          {editing.error.message}
        </p>
      ) : null}
    </section>
  );
}

function PinnedProperty({
  property,
  task,
  states,
  assigneeCandidates,
  canEdit,
  editing,
}: {
  property: (typeof PINNED_PROPERTIES)[number];
  task: Task;
  states: TaskState[];
  assigneeCandidates: TaskAssignee[];
  canEdit: boolean;
  editing: TaskPropertyEditing;
}) {
  const invalid = editing.failedProperties.has(property.key);
  let control: ReactNode;

  switch (property.key) {
    case 'state':
      control = canEdit ? (
        <Select
          ariaLabel="State"
          className="task-pinned-select"
          value={task.state.id}
          startIcon={<StateIcon role={task.state.system_role} size={18} />}
          disabled={editing.disabled('state')}
          invalid={invalid}
          options={selectableStates(states, task).map((state) => ({
            value: state.id,
            label: state.name,
            icon: <StateIcon role={state.system_role} size={18} />,
          }))}
          onValueChange={(value) =>
            void editing.patchProperty('state', { state_id: value })
          }
        />
      ) : (
        <span className="property-readonly-value task-value-readonly">
          <StateIcon role={task.state.system_role} size={18} />
          <span>{task.state.name}</span>
        </span>
      );
      break;
    case 'priority':
      control = canEdit ? (
        <Select
          ariaLabel="Priority"
          className="task-pinned-select"
          value={task.priority}
          startIcon={<PriorityIcon priority={task.priority} size={16} />}
          disabled={editing.disabled('priority')}
          invalid={invalid}
          options={TASK_PRIORITY_OPTIONS.map((option) => ({
            ...option,
            icon: <PriorityIcon priority={option.value} size={16} />,
          }))}
          onValueChange={(value) =>
            void editing.patchProperty('priority', {
              priority: value as Task['priority'],
            })
          }
        />
      ) : (
        <span className="property-readonly-value task-value-readonly">
          <PriorityIcon priority={task.priority} size={16} />
          <span>{priorityLabel(task.priority)}</span>
        </span>
      );
      break;
    case 'assignees':
      control = (
        <MultiValuePicker
          label="Edit assignees"
          emptyLabel="Unassigned"
          readOnly={!canEdit}
          saving={editing.savingProperties.has('assignees')}
          values={task.assignees.map(({ user_id }) => user_id)}
          options={assigneeCandidates.map((member) => ({
            id: member.user_id,
            label: member.display_name,
          }))}
          onChange={async (assigneeIds) => {
            await editing.patchProperty('assignees', {
              assignee_ids: assigneeIds,
            });
          }}
        />
      );
      break;
    case 'start-date':
      control = canEdit ? (
        <TaskDateControl
          label="Start date"
          className="task-pinned-date"
          value={task.start_date}
          disabled={editing.disabled('start-date')}
          invalid={invalid}
          onChange={(value) =>
            editing.patchProperty('start-date', { start_date: value })
          }
        />
      ) : (
        <span className="property-readonly-value">
          {task.start_date || 'Start date'}
        </span>
      );
      break;
    case 'due-date':
      control = canEdit ? (
        <TaskDateControl
          label="Due date"
          className="task-pinned-date"
          value={task.due_date}
          disabled={editing.disabled('due-date')}
          invalid={invalid}
          onChange={(value) =>
            editing.patchProperty('due-date', { due_date: value })
          }
        />
      ) : (
        <span className="property-readonly-value">
          {task.due_date || 'Due date'}
        </span>
      );
      break;
  }

  return (
    <div
      className="task-pinned-property"
      data-task-property={property.key}
      data-invalid={invalid || undefined}
    >
      <TaskPropertyIcon propertyKey={property.key} />
      {control}
    </div>
  );
}
