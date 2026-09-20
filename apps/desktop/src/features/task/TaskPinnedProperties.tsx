import {
  CalendarCheck,
  CalendarDays,
  CircleDot,
  Flag,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import type {
  Task,
  TaskAssignee,
  TaskPriority,
  TaskState,
} from '../workspace/types';
import { MultiValuePicker } from './TaskPropertyControls';
import {
  PINNED_PROPERTIES,
  isPinnedProperty,
  selectableStates,
  type PinnedPropertyKey,
} from './taskPropertyModel';
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
          disabled={editing.disabled('state')}
          invalid={invalid}
          options={selectableStates(states, task).map((state) => ({
            value: state.id,
            label: state.name,
          }))}
          onValueChange={(value) =>
            void editing.patchProperty('state', { state_id: value })
          }
        />
      ) : (
        <span className="property-readonly-value">{task.state.name}</span>
      );
      break;
    case 'priority':
      control = canEdit ? (
        <Select
          ariaLabel="Priority"
          className="task-pinned-select"
          value={task.priority}
          disabled={editing.disabled('priority')}
          invalid={invalid}
          options={[
            { value: 'none', label: 'No priority' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'urgent', label: 'Urgent' },
          ]}
          onValueChange={(value) =>
            void editing.patchProperty('priority', {
              priority: value as TaskPriority,
            })
          }
        />
      ) : (
        <span className="property-readonly-value">
          {priorityLabel(task.priority)}
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
        <PinnedDateInput
          label="Start date"
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
        <PinnedDateInput
          label="Due date"
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
      <PinnedPropertyIcon propertyKey={property.key} />
      {control}
    </div>
  );
}

function priorityLabel(priority: TaskPriority) {
  if (priority === 'none') return 'No priority';
  return `${priority[0].toUpperCase()}${priority.slice(1)}`;
}

function PinnedPropertyIcon({
  propertyKey,
}: {
  propertyKey: PinnedPropertyKey;
}) {
  const iconProps = { 'aria-hidden': true as const, size: 14 };
  switch (propertyKey) {
    case 'state':
      return <CircleDot {...iconProps} />;
    case 'priority':
      return <Flag {...iconProps} />;
    case 'assignees':
      return <Users {...iconProps} />;
    case 'start-date':
      return <CalendarDays {...iconProps} />;
    case 'due-date':
      return <CalendarCheck {...iconProps} />;
  }
}

function PinnedDateInput({
  label,
  value,
  disabled,
  invalid,
  onChange,
}: {
  label: string;
  value: string | null;
  disabled: boolean;
  invalid: boolean;
  onChange: (value: string | null) => Promise<boolean>;
}) {
  return (
    <label className="task-pinned-date">
      <span aria-hidden="true">{value || label}</span>
      <Input
        aria-label={label}
        type="date"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        value={value ?? ''}
        onChange={(event) => void onChange(event.target.value || null)}
      />
    </label>
  );
}
