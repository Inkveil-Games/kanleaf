import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState, type CSSProperties, type DragEvent } from 'react';
import { Checkbox } from '../../components/ui/Checkbox';
import { IconButton } from '../../components/ui/IconButton';
import { Select } from '../../components/ui/Select';
import type {
  Project,
  Task,
  TaskPatch,
  TaskPriority,
  TaskState,
} from '../workspace/types';
import type { TaskGroupField, TaskLayout, TaskQuery } from './types';
import { buildTaskGroups, type TaskGroup } from './grouping';

interface TaskLayoutsProps {
  layout: Exclude<TaskLayout, 'list'>;
  query: TaskQuery;
  tasks: Task[];
  projects: Project[];
  states: TaskState[];
  selectedTaskId: string | null;
  checkedTaskIds: Set<string>;
  canEditTask: (task: Task) => boolean;
  onSelectTask: (taskId: string) => void;
  onToggleChecked: (taskId: string) => void;
  onPatchTask: (taskId: string, patch: TaskPatch) => Promise<void>;
}

export function TaskLayouts(props: TaskLayoutsProps) {
  switch (props.layout) {
    case 'board':
      return <TaskBoard {...props} />;
    case 'calendar':
      return <TaskCalendar {...props} />;
    case 'table':
      return <TaskTable {...props} />;
    case 'timeline':
      return <TaskTimeline {...props} />;
  }
}

function TaskBoard({
  query,
  tasks,
  projects,
  states,
  selectedTaskId,
  canEditTask,
  onSelectTask,
  onPatchTask,
}: TaskLayoutsProps) {
  const field = query.grouping.primary ?? 'state_group';
  const groups = buildTaskGroups(field, tasks, projects, states);

  async function dropTask(event: DragEvent, group: TaskGroup) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/kanleaf-task');
    const task = tasks.find(({ id }) => id === taskId);
    if (!task || !canEditTask(task)) return;
    const patch = boardDropPatch(field, group.id, states);
    if (patch) await onPatchTask(taskId, patch);
  }

  return (
    <div className="task-board" aria-label={`Board grouped by ${field}`}>
      {groups.map((group) => {
        const groupedTasks = tasks.filter((task) => group.taskIds.has(task.id));
        const secondaryGroups = query.grouping.secondary
          ? buildTaskGroups(
              query.grouping.secondary,
              groupedTasks,
              projects,
              states,
            ).filter(({ taskIds }) => taskIds.size > 0)
          : [];
        return (
          <section
            className="board-column"
            key={group.id}
            onDragOver={(event) => {
              if (boardDropPatch(field, group.id, states)) {
                event.preventDefault();
              }
            }}
            onDrop={(event) => void dropTask(event, group)}
          >
            <header>
              {group.color && (
                <span
                  style={{ '--group-color': group.color } as CSSProperties}
                />
              )}
              <h2>{group.label}</h2>
              <small>{groupedTasks.length}</small>
            </header>
            <div className="board-column-list">
              {secondaryGroups.length > 0
                ? secondaryGroups.map((secondary) => (
                    <section className="board-subgroup" key={secondary.id}>
                      <h3>{secondary.label}</h3>
                      {groupedTasks
                        .filter((task) => secondary.taskIds.has(task.id))
                        .map((task) => (
                          <BoardTaskButton
                            key={task.id}
                            task={task}
                            selected={task.id === selectedTaskId}
                            draggable={canEditTask(task)}
                            onSelect={() => onSelectTask(task.id)}
                          />
                        ))}
                    </section>
                  ))
                : groupedTasks.map((task) => (
                    <BoardTaskButton
                      key={task.id}
                      task={task}
                      selected={task.id === selectedTaskId}
                      draggable={canEditTask(task)}
                      onSelect={() => onSelectTask(task.id)}
                    />
                  ))}
              {groupedTasks.length === 0 && <p>Drop tasks here</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function BoardTaskButton({
  task,
  selected,
  draggable,
  onSelect,
}: {
  task: Task;
  selected: boolean;
  draggable: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className="board-task"
      data-selected={selected || undefined}
      type="button"
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/kanleaf-task', task.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onSelect}
    >
      <span>{task.title}</span>
      <small>
        {task.reference}
        {task.priority !== 'none' && ` · ${task.priority}`}
        {task.due_date && ` · ${formatShortDate(task.due_date)}`}
      </small>
    </button>
  );
}

function TaskCalendar({
  tasks,
  selectedTaskId,
  canEditTask,
  onSelectTask,
  onPatchTask,
}: TaskLayoutsProps) {
  const firstScheduled = tasks.find(({ due_date }) => due_date)?.due_date;
  const [anchor, setAnchor] = useState(() =>
    firstScheduled ? parseDate(firstScheduled) : startOfDay(new Date()),
  );
  const days = useMemo(() => calendarDays(anchor), [anchor]);
  const unscheduled = tasks.filter(({ due_date }) => !due_date);

  async function dropOnDate(event: DragEvent, dueDate: string | null) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/kanleaf-task');
    const task = tasks.find(({ id }) => id === taskId);
    if (task && canEditTask(task)) {
      await onPatchTask(task.id, { due_date: dueDate });
    }
  }

  return (
    <div className="task-calendar">
      <header className="calendar-toolbar">
        <IconButton
          variant="ghost"
          size="sm"
          type="button"
          aria-label="Previous month"
          onClick={() => setAnchor(addMonths(anchor, -1))}
        >
          <ChevronLeft aria-hidden="true" size={15} />
        </IconButton>
        <h2>
          {new Intl.DateTimeFormat(undefined, {
            month: 'long',
            year: 'numeric',
          }).format(anchor)}
        </h2>
        <IconButton
          variant="ghost"
          size="sm"
          type="button"
          aria-label="Next month"
          onClick={() => setAnchor(addMonths(anchor, 1))}
        >
          <ChevronRight aria-hidden="true" size={15} />
        </IconButton>
      </header>
      <div className="calendar-weekdays" aria-hidden="true">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="calendar-grid" role="grid" aria-label="Task due dates">
        {days.map((day) => {
          const key = toDateInput(day);
          const dayTasks = tasks.filter(({ due_date }) => due_date === key);
          return (
            <div
              className="calendar-day"
              data-outside={day.getMonth() !== anchor.getMonth() || undefined}
              data-today={isSameDay(day, new Date()) || undefined}
              key={key}
              role="gridcell"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => void dropOnDate(event, key)}
            >
              <span>{day.getDate()}</span>
              {dayTasks.map((task) => (
                <CalendarTask
                  key={task.id}
                  task={task}
                  selected={task.id === selectedTaskId}
                  draggable={canEditTask(task)}
                  onSelect={() => onSelectTask(task.id)}
                />
              ))}
            </div>
          );
        })}
      </div>
      {unscheduled.length > 0 && (
        <section
          className="calendar-unscheduled"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => void dropOnDate(event, null)}
        >
          <strong>Unscheduled</strong>
          {unscheduled.map((task) => (
            <CalendarTask
              key={task.id}
              task={task}
              selected={task.id === selectedTaskId}
              draggable={canEditTask(task)}
              onSelect={() => onSelectTask(task.id)}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function CalendarTask({
  task,
  selected,
  draggable,
  onSelect,
}: {
  task: Task;
  selected: boolean;
  draggable: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className="calendar-task"
      data-selected={selected || undefined}
      type="button"
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/kanleaf-task', task.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onSelect}
    >
      <span
        style={{ '--task-state-color': task.state.color } as CSSProperties}
      />
      {task.title}
    </button>
  );
}

function TaskTable({
  query,
  tasks,
  projects,
  states,
  selectedTaskId,
  checkedTaskIds,
  canEditTask,
  onSelectTask,
  onToggleChecked,
  onPatchTask,
}: TaskLayoutsProps) {
  const show = (property: string) => query.display.includes(property as never);
  return (
    <div className="task-table-wrap">
      <table className="task-table">
        <thead>
          <tr>
            <th aria-label="Select" />
            <th>Task</th>
            {show('state') && <th>State</th>}
            {show('task_type') && <th>Type</th>}
            {show('priority') && <th>Priority</th>}
            {show('project') && <th>Project</th>}
            {show('assignees') && <th>Assignees</th>}
            {show('labels') && <th>Labels</th>}
            {show('cycle') && <th>Cycle</th>}
            {show('modules') && <th>Modules</th>}
            {show('start_date') && <th>Start</th>}
            {show('due_date') && <th>Due</th>}
            {show('estimate') && <th>Estimate</th>}
            {show('updated_at') && <th>Updated</th>}
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const editable = canEditTask(task);
            return (
              <tr
                data-selected={task.id === selectedTaskId || undefined}
                key={task.id}
              >
                <td>
                  <Checkbox
                    aria-label={`Select ${task.title}`}
                    checked={checkedTaskIds.has(task.id)}
                    onCheckedChange={() => onToggleChecked(task.id)}
                  />
                </td>
                <th scope="row">
                  <button type="button" onClick={() => onSelectTask(task.id)}>
                    <span>{task.title}</span>
                    <small>{task.reference}</small>
                  </button>
                </th>
                {show('state') && (
                  <td>
                    <Select
                      ariaLabel={`${task.title} state`}
                      value={task.state.id}
                      disabled={!editable}
                      options={states
                        .filter(({ archived_at }) => !archived_at)
                        .map((state) => ({
                          value: state.id,
                          label: state.name,
                        }))}
                      onValueChange={(value) =>
                        void onPatchTask(task.id, {
                          state_id: value,
                        })
                      }
                    />
                  </td>
                )}
                {show('task_type') && <td>{task.task_type.name}</td>}
                {show('priority') && (
                  <td>
                    <Select
                      ariaLabel={`${task.title} priority`}
                      value={task.priority}
                      disabled={!editable}
                      options={(
                        ['none', 'low', 'medium', 'high', 'urgent'] as const
                      ).map((priority) => ({
                        value: priority,
                        label: capitalize(priority),
                      }))}
                      onValueChange={(value) =>
                        void onPatchTask(task.id, {
                          priority: value as TaskPriority,
                        })
                      }
                    />
                  </td>
                )}
                {show('project') && (
                  <td>
                    {projects.find(({ id }) => id === task.project_id)?.name ??
                      'Inbox'}
                  </td>
                )}
                {show('assignees') && (
                  <td>
                    {task.assignees
                      .map(({ display_name }) => display_name)
                      .join(', ') || '—'}
                  </td>
                )}
                {show('labels') && (
                  <td>
                    {task.labels.map(({ name }) => name).join(', ') || '—'}
                  </td>
                )}
                {show('cycle') && <td>{task.cycle?.name ?? '—'}</td>}
                {show('modules') && (
                  <td>
                    {task.modules.map(({ name }) => name).join(', ') || '—'}
                  </td>
                )}
                {show('start_date') && <td>{task.start_date ?? '—'}</td>}
                {show('due_date') && <td>{task.due_date ?? '—'}</td>}
                {show('estimate') && <td>{task.estimate ?? '—'}</td>}
                {show('updated_at') && (
                  <td>{formatShortDate(task.updated_at.slice(0, 10))}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TaskTimeline({
  tasks,
  selectedTaskId,
  canEditTask,
  onSelectTask,
  onPatchTask,
}: TaskLayoutsProps) {
  const anchor = useMemo(() => timelineAnchor(tasks), [tasks]);
  const days = useMemo(
    () => Array.from({ length: 21 }, (_, index) => addDays(anchor, index)),
    [anchor],
  );
  const unscheduled = tasks.filter(
    (task) => !task.start_date && !task.due_date,
  );

  async function moveTask(event: DragEvent, date: Date) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/kanleaf-task');
    const mode = event.dataTransfer.getData('text/kanleaf-timeline-mode');
    const task = tasks.find(({ id }) => id === taskId);
    if (!task || !canEditTask(task)) return;
    if (mode === 'start') {
      await onPatchTask(task.id, { start_date: toDateInput(date) });
      return;
    }
    if (mode === 'end') {
      await onPatchTask(task.id, { due_date: toDateInput(date) });
      return;
    }
    const duration = taskDuration(task);
    const start = toDateInput(date);
    await onPatchTask(task.id, {
      start_date: task.start_date ? start : null,
      due_date: toDateInput(addDays(date, duration)),
    });
  }

  return (
    <div className="task-timeline">
      <div className="timeline-header timeline-task-heading">Task</div>
      <div className="timeline-dates">
        {days.map((day) => (
          <span
            data-today={isSameDay(day, new Date()) || undefined}
            key={toDateInput(day)}
          >
            {day.getDate()}
            <small>
              {day.toLocaleDateString(undefined, { weekday: 'short' })}
            </small>
          </span>
        ))}
      </div>
      {tasks
        .filter((task) => task.start_date || task.due_date)
        .map((task) => {
          const range = timelineRange(task, anchor, days.length);
          return (
            <div className="timeline-row" key={task.id}>
              <button
                className="timeline-task-name"
                data-selected={task.id === selectedTaskId || undefined}
                type="button"
                onClick={() => onSelectTask(task.id)}
              >
                <span>{task.title}</span>
                <small>{task.reference}</small>
              </button>
              <div className="timeline-track">
                {days.map((day) => (
                  <span
                    key={toDateInput(day)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => void moveTask(event, day)}
                  />
                ))}
                <div
                  className="timeline-bar"
                  style={
                    {
                      '--timeline-start': range.start,
                      '--timeline-span': range.span,
                      '--task-state-color': task.state.color,
                    } as CSSProperties
                  }
                >
                  {canEditTask(task) && (
                    <button
                      className="timeline-resize-handle timeline-resize-start"
                      type="button"
                      draggable
                      aria-label={`Resize ${task.title} start`}
                      title="Drag to change the start date; click to extend one day"
                      onDragStart={(event) => {
                        event.dataTransfer.setData(
                          'text/kanleaf-task',
                          task.id,
                        );
                        event.dataTransfer.setData(
                          'text/kanleaf-timeline-mode',
                          'start',
                        );
                      }}
                      onClick={() => {
                        const start = parseDate(
                          task.start_date ?? task.due_date!,
                        );
                        void onPatchTask(task.id, {
                          start_date: toDateInput(addDays(start, -1)),
                        });
                      }}
                    />
                  )}
                  <button
                    className="timeline-bar-main"
                    type="button"
                    draggable={canEditTask(task)}
                    title="Drag to move this schedule"
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/kanleaf-task', task.id);
                      event.dataTransfer.setData(
                        'text/kanleaf-timeline-mode',
                        'move',
                      );
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => onSelectTask(task.id)}
                  >
                    {task.title}
                  </button>
                  {canEditTask(task) && (
                    <button
                      className="timeline-resize-handle timeline-resize-end"
                      type="button"
                      draggable
                      aria-label={`Resize ${task.title} end`}
                      title="Drag to change the due date; click to extend one day"
                      onDragStart={(event) => {
                        event.dataTransfer.setData(
                          'text/kanleaf-task',
                          task.id,
                        );
                        event.dataTransfer.setData(
                          'text/kanleaf-timeline-mode',
                          'end',
                        );
                      }}
                      onClick={() => {
                        const end = parseDate(
                          task.due_date ?? task.start_date!,
                        );
                        void onPatchTask(task.id, {
                          due_date: toDateInput(addDays(end, 1)),
                        });
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      {unscheduled.length > 0 && (
        <section className="timeline-unscheduled">
          <CalendarDays aria-hidden="true" size={14} />
          <strong>Unscheduled</strong>
          {unscheduled.map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => onSelectTask(task.id)}
            >
              {task.title}
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

function boardDropPatch(
  field: TaskGroupField,
  id: string,
  states: TaskState[],
): TaskPatch | null {
  if (field === 'state') return { state_id: id };
  if (field === 'state_group') {
    const state = states.find(
      ({ archived_at, state_group }) => !archived_at && state_group === id,
    );
    return state ? { state_id: state.id } : null;
  }
  if (field === 'priority') return { priority: id as TaskPriority };
  if (field === 'project') return { project_id: id === 'none' ? null : id };
  return null;
}

function calendarDays(anchor: Date) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = addDays(first, -mondayOffset);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function timelineAnchor(tasks: Task[]) {
  const dates = tasks
    .flatMap((task) => [task.start_date, task.due_date])
    .filter(Boolean) as string[];
  const earliest = dates.sort()[0];
  return addDays(earliest ? parseDate(earliest) : startOfDay(new Date()), -3);
}

function timelineRange(task: Task, anchor: Date, length: number) {
  const start = parseDate(task.start_date ?? task.due_date!);
  const due = parseDate(task.due_date ?? task.start_date!);
  const rawStart = dayDifference(anchor, start) + 1;
  const rawEnd = dayDifference(anchor, due) + 2;
  const clippedStart = Math.max(1, Math.min(length, rawStart));
  const clippedEnd = Math.max(clippedStart + 1, Math.min(length + 1, rawEnd));
  return { start: clippedStart, span: clippedEnd - clippedStart };
}

function taskDuration(task: Task) {
  if (!task.start_date || !task.due_date) return 0;
  return Math.max(
    0,
    dayDifference(parseDate(task.start_date), parseDate(task.due_date)),
  );
}

function parseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, amount: number) {
  return new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate() + amount,
  );
}

function addMonths(value: Date, amount: number) {
  return new Date(value.getFullYear(), value.getMonth() + amount, 1);
}

function dayDifference(from: Date, to: Date) {
  return Math.round(
    (startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000,
  );
}

function isSameDay(first: Date, second: Date) {
  return toDateInput(first) === toDateInput(second);
}

function toDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(parseDate(value));
}

function capitalize(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
