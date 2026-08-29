import {
  ArrowDownAZ,
  CalendarRange,
  Columns3,
  Filter,
  Group,
  Save,
  SlidersHorizontal,
} from 'lucide-react';
import { useState } from 'react';
import { ContextMenu } from '../../components/ui/ContextMenu';
import type {
  Project,
  TaskLabel,
  TaskPlanningLink,
  TaskPriority,
  TaskState,
  TaskType,
} from '../workspace/types';
import { SavedViewDialog } from './SavedViewDialog';
import type {
  DateFilter,
  SavedView,
  SavedViewVisibility,
  TaskDisplayProperty,
  TaskGroupField,
  TaskLayout,
  TaskQuery,
  TaskSortField,
} from './types';

interface TaskViewToolbarProps {
  query: TaskQuery;
  layout: TaskLayout;
  states: TaskState[];
  labels: TaskLabel[];
  taskTypes: TaskType[];
  projects: Project[];
  cycles: TaskPlanningLink[];
  modules: TaskPlanningLink[];
  members: { user_id: string; display_name: string }[];
  activeView: SavedView | null;
  canShare: boolean;
  canManageActiveView: boolean;
  canChangeActiveViewVisibility: boolean;
  onQueryChange: (query: TaskQuery) => void;
  onLayoutChange: (layout: TaskLayout) => void;
  onCreateView: (
    name: string,
    visibility: SavedViewVisibility,
  ) => Promise<void>;
  onUpdateView: (
    patch: Partial<Pick<SavedView, 'name' | 'visibility'>>,
  ) => Promise<void>;
  onSaveViewConfiguration: () => Promise<void>;
  onDuplicateView: (
    name: string,
    visibility: SavedViewVisibility,
  ) => Promise<void>;
  onDeleteView: () => Promise<void>;
  onActionError: (message: string) => void;
}

type ViewDialogMode = 'create' | 'rename' | 'duplicate' | null;

const priorities: TaskPriority[] = ['none', 'low', 'medium', 'high', 'urgent'];

const displayProperties: TaskDisplayProperty[] = [
  'state',
  'priority',
  'task_type',
  'assignees',
  'labels',
  'project',
  'cycle',
  'modules',
  'start_date',
  'due_date',
  'estimate',
  'updated_at',
];

const groupFields: { value: TaskGroupField; label: string }[] = [
  { value: 'state', label: 'State' },
  { value: 'state_group', label: 'State group' },
  { value: 'priority', label: 'Priority' },
  { value: 'task_type', label: 'Task type' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'label', label: 'Label' },
  { value: 'project', label: 'Project' },
  { value: 'cycle', label: 'Cycle' },
  { value: 'module', label: 'Module' },
  { value: 'due_date', label: 'Due date' },
];

const sortFields: { value: TaskSortField; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'priority', label: 'Priority' },
  { value: 'start_date', label: 'Start date' },
  { value: 'due_date', label: 'Due date' },
  { value: 'estimate', label: 'Estimate' },
  { value: 'updated_at', label: 'Updated' },
];

export function TaskViewToolbar({
  query,
  layout,
  states,
  labels,
  taskTypes,
  projects,
  cycles,
  modules,
  members,
  activeView,
  canShare,
  canManageActiveView,
  canChangeActiveViewVisibility,
  onQueryChange,
  onLayoutChange,
  onCreateView,
  onUpdateView,
  onSaveViewConfiguration,
  onDuplicateView,
  onDeleteView,
  onActionError,
}: TaskViewToolbarProps) {
  const [dialog, setDialog] = useState<ViewDialogMode>(null);

  function patchFilters(filters: Partial<TaskQuery['filters']>) {
    onQueryChange({
      ...query,
      filters: { ...query.filters, ...filters },
    });
  }

  function toggleFilterValue<T>(values: T[], value: T) {
    return values.includes(value)
      ? values.filter((current) => current !== value)
      : [...values, value];
  }

  function runAction(action: () => Promise<void>) {
    void action().catch((caught: unknown) =>
      onActionError(
        caught instanceof Error ? caught.message : 'View action failed',
      ),
    );
  }

  return (
    <>
      <div className="view-toolbar" aria-label="Task view controls">
        <label className="view-layout-select">
          <Columns3 aria-hidden="true" size={14} />
          <span className="sr-only">Layout</span>
          <select
            aria-label="Layout"
            value={layout}
            onChange={(event) =>
              onLayoutChange(event.target.value as TaskLayout)
            }
          >
            <option value="list">List</option>
            <option value="board">Board</option>
            <option value="calendar">Calendar</option>
            <option value="table">Table</option>
            <option value="timeline">Timeline</option>
          </select>
        </label>

        <ContextMenu
          label="Filter tasks"
          className="view-control-menu"
          trigger={<Filter aria-hidden="true" size={14} />}
        >
          <MenuHeading>State</MenuHeading>
          {states
            .filter(({ archived_at }) => !archived_at)
            .map((state) => (
              <CheckMenuItem
                key={state.id}
                checked={query.filters.states.values.includes(state.id)}
                label={state.name}
                onClick={() =>
                  patchFilters({
                    states: {
                      ...query.filters.states,
                      values: toggleFilterValue(
                        query.filters.states.values,
                        state.id,
                      ),
                    },
                  })
                }
              />
            ))}
          {taskTypes.length > 0 && <MenuHeading>Task type</MenuHeading>}
          {taskTypes
            .filter(({ archived_at }) => !archived_at)
            .map((taskType) => (
              <CheckMenuItem
                key={taskType.id}
                checked={query.filters.task_types.values.includes(taskType.id)}
                label={taskType.name}
                onClick={() =>
                  patchFilters({
                    task_types: {
                      ...query.filters.task_types,
                      values: toggleFilterValue(
                        query.filters.task_types.values,
                        taskType.id,
                      ),
                    },
                  })
                }
              />
            ))}
          <MenuHeading>Priority</MenuHeading>
          {priorities.map((priority) => (
            <CheckMenuItem
              key={priority}
              checked={query.filters.priorities.includes(priority)}
              label={labelFor(priority)}
              onClick={() =>
                patchFilters({
                  priorities: toggleFilterValue(
                    query.filters.priorities,
                    priority,
                  ),
                })
              }
            />
          ))}
          {members.length > 0 && <MenuHeading>Assignee</MenuHeading>}
          {members.map((member) => (
            <CheckMenuItem
              key={member.user_id}
              checked={query.filters.assignees.values.includes(member.user_id)}
              label={member.display_name}
              onClick={() =>
                patchFilters({
                  assignees: {
                    ...query.filters.assignees,
                    values: toggleFilterValue(
                      query.filters.assignees.values,
                      member.user_id,
                    ),
                  },
                })
              }
            />
          ))}
          {members.length > 0 && (
            <CheckMenuItem
              checked={query.filters.assignees.include_none}
              label="No assignee"
              onClick={() =>
                patchFilters({
                  assignees: {
                    ...query.filters.assignees,
                    include_none: !query.filters.assignees.include_none,
                  },
                })
              }
            />
          )}
          {labels.length > 0 && <MenuHeading>Label</MenuHeading>}
          {labels
            .filter(({ archived_at }) => !archived_at)
            .map((label) => (
              <CheckMenuItem
                key={label.id}
                checked={query.filters.labels.values.includes(label.id)}
                label={label.name}
                onClick={() =>
                  patchFilters({
                    labels: {
                      ...query.filters.labels,
                      values: toggleFilterValue(
                        query.filters.labels.values,
                        label.id,
                      ),
                    },
                  })
                }
              />
            ))}
          {labels.length > 0 && (
            <CheckMenuItem
              checked={query.filters.labels.include_none}
              label="No label"
              onClick={() =>
                patchFilters({
                  labels: {
                    ...query.filters.labels,
                    include_none: !query.filters.labels.include_none,
                  },
                })
              }
            />
          )}
          {projects.length > 0 && <MenuHeading>Project</MenuHeading>}
          {projects.map((project) => (
            <CheckMenuItem
              key={project.id}
              checked={query.filters.projects.values.includes(project.id)}
              label={project.name}
              onClick={() =>
                patchFilters({
                  projects: {
                    ...query.filters.projects,
                    values: toggleFilterValue(
                      query.filters.projects.values,
                      project.id,
                    ),
                  },
                })
              }
            />
          ))}
          {projects.length > 0 && (
            <CheckMenuItem
              checked={query.filters.projects.include_none}
              label="Inbox"
              onClick={() =>
                patchFilters({
                  projects: {
                    ...query.filters.projects,
                    include_none: !query.filters.projects.include_none,
                  },
                })
              }
            />
          )}
          {cycles.length > 0 && <MenuHeading>Cycle</MenuHeading>}
          {cycles.map((cycle) => (
            <CheckMenuItem
              key={cycle.id}
              checked={query.filters.cycles.values.includes(cycle.id)}
              label={cycle.name}
              onClick={() =>
                patchFilters({
                  cycles: {
                    ...query.filters.cycles,
                    values: toggleFilterValue(
                      query.filters.cycles.values,
                      cycle.id,
                    ),
                  },
                })
              }
            />
          ))}
          {cycles.length > 0 && (
            <CheckMenuItem
              checked={query.filters.cycles.include_none}
              label="No cycle"
              onClick={() =>
                patchFilters({
                  cycles: {
                    ...query.filters.cycles,
                    include_none: !query.filters.cycles.include_none,
                  },
                })
              }
            />
          )}
          {modules.length > 0 && <MenuHeading>Module</MenuHeading>}
          {modules.map((module) => (
            <CheckMenuItem
              key={module.id}
              checked={query.filters.modules.values.includes(module.id)}
              label={module.name}
              onClick={() =>
                patchFilters({
                  modules: {
                    ...query.filters.modules,
                    values: toggleFilterValue(
                      query.filters.modules.values,
                      module.id,
                    ),
                  },
                })
              }
            />
          ))}
          {modules.length > 0 && (
            <CheckMenuItem
              checked={query.filters.modules.include_none}
              label="No module"
              onClick={() =>
                patchFilters({
                  modules: {
                    ...query.filters.modules,
                    include_none: !query.filters.modules.include_none,
                  },
                })
              }
            />
          )}
          <MenuHeading>Completion</MenuHeading>
          <CheckMenuItem
            checked={query.include_completed}
            label="Include completed"
            onClick={() =>
              onQueryChange({
                ...query,
                include_completed: !query.include_completed,
              })
            }
          />
        </ContextMenu>

        <ContextMenu
          label="Date and estimate filters"
          className="view-range-menu"
          trigger={<CalendarRange aria-hidden="true" size={14} />}
          popoverRole="dialog"
        >
          <div className="view-range-filters">
            <DateRangeControl
              label="Start date"
              value={query.filters.start_date}
              onChange={(start_date) => patchFilters({ start_date })}
            />
            <DateRangeControl
              label="Due date"
              value={query.filters.due_date}
              onChange={(due_date) => patchFilters({ due_date })}
            />
            <fieldset>
              <legend>Estimate</legend>
              <label>
                <span>Minimum</span>
                <input
                  type="number"
                  min="0"
                  value={query.filters.estimate.minimum ?? ''}
                  onChange={(event) =>
                    patchFilters({
                      estimate: {
                        ...query.filters.estimate,
                        minimum: optionalNumber(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <label>
                <span>Maximum</span>
                <input
                  type="number"
                  min="0"
                  value={query.filters.estimate.maximum ?? ''}
                  onChange={(event) =>
                    patchFilters({
                      estimate: {
                        ...query.filters.estimate,
                        maximum: optionalNumber(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <label className="view-range-check">
                <input
                  type="checkbox"
                  checked={query.filters.estimate.include_none}
                  onChange={() =>
                    patchFilters({
                      estimate: {
                        ...query.filters.estimate,
                        include_none: !query.filters.estimate.include_none,
                      },
                    })
                  }
                />
                Include unestimated
              </label>
            </fieldset>
          </div>
        </ContextMenu>

        <label className="view-compact-select">
          <Group aria-hidden="true" size={14} />
          <span className="sr-only">Group by</span>
          <select
            aria-label="Group by"
            value={query.grouping.primary ?? ''}
            onChange={(event) =>
              onQueryChange({
                ...query,
                grouping: {
                  primary: (event.target.value ||
                    null) as TaskGroupField | null,
                  secondary: null,
                },
              })
            }
          >
            <option value="">No grouping</option>
            {groupFields.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {query.grouping.primary && (
          <label className="view-compact-select view-secondary-select">
            <span>then</span>
            <select
              aria-label="Then group by"
              value={query.grouping.secondary ?? ''}
              onChange={(event) =>
                onQueryChange({
                  ...query,
                  grouping: {
                    ...query.grouping,
                    secondary: (event.target.value ||
                      null) as TaskGroupField | null,
                  },
                })
              }
            >
              <option value="">No second group</option>
              {groupFields
                .filter(({ value }) => value !== query.grouping.primary)
                .map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
        )}

        <label className="view-compact-select">
          <ArrowDownAZ aria-hidden="true" size={14} />
          <span className="sr-only">Sort by</span>
          <select
            aria-label="Sort by"
            value={query.sort[0]?.field ?? ''}
            onChange={(event) => {
              const field = event.target.value as TaskSortField;
              onQueryChange({
                ...query,
                sort: field ? [{ field, direction: 'ascending' }] : [],
              });
            }}
          >
            <option value="">Manual</option>
            <option value="title">Title</option>
            <option value="priority">Priority</option>
            <option value="start_date">Start date</option>
            <option value="due_date">Due date</option>
            <option value="estimate">Estimate</option>
            <option value="updated_at">Updated</option>
          </select>
        </label>
        {query.sort[0] && (
          <>
            <button
              className="view-sort-direction"
              type="button"
              aria-label={`Sort direction: ${query.sort[0].direction}`}
              onClick={() =>
                onQueryChange({
                  ...query,
                  sort: [
                    {
                      ...query.sort[0]!,
                      direction:
                        query.sort[0]!.direction === 'ascending'
                          ? 'descending'
                          : 'ascending',
                    },
                    ...query.sort.slice(1),
                  ],
                })
              }
            >
              {query.sort[0].direction === 'ascending' ? '↑' : '↓'}
            </button>
            <label className="view-compact-select view-secondary-select">
              <span>then</span>
              <select
                aria-label="Then sort by"
                value={query.sort[1]?.field ?? ''}
                onChange={(event) => {
                  const field = event.target.value as TaskSortField;
                  onQueryChange({
                    ...query,
                    sort: field
                      ? [query.sort[0]!, { field, direction: 'ascending' }]
                      : [query.sort[0]!],
                  });
                }}
              >
                <option value="">No second sort</option>
                {sortFields
                  .filter(({ value }) => value !== query.sort[0]?.field)
                  .map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}

        <ContextMenu
          label="Visible task fields"
          className="view-control-menu"
          trigger={<SlidersHorizontal aria-hidden="true" size={14} />}
        >
          {displayProperties.map((property) => (
            <CheckMenuItem
              key={property}
              checked={query.display.includes(property)}
              label={labelFor(property)}
              onClick={() =>
                onQueryChange({
                  ...query,
                  display: toggleFilterValue(query.display, property),
                })
              }
            />
          ))}
        </ContextMenu>

        <span className="view-toolbar-spacer" />
        {activeView ? (
          <>
            {canManageActiveView && (
              <button
                className="view-save-button"
                type="button"
                onClick={() => runAction(onSaveViewConfiguration)}
              >
                <Save aria-hidden="true" size={14} /> Save changes
              </button>
            )}
            <ContextMenu
              label="Saved view actions"
              className="view-actions-menu"
            >
              {canManageActiveView && (
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => setDialog('rename')}
                >
                  Rename
                </button>
              )}
              <button
                role="menuitem"
                type="button"
                onClick={() => setDialog('duplicate')}
              >
                Duplicate
              </button>
              {canChangeActiveViewVisibility &&
                (activeView.visibility === 'shared' || canShare) && (
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() =>
                      runAction(() =>
                        onUpdateView({
                          visibility:
                            activeView.visibility === 'shared'
                              ? 'personal'
                              : 'shared',
                        }),
                      )
                    }
                  >
                    Make{' '}
                    {activeView.visibility === 'shared' ? 'personal' : 'shared'}
                  </button>
                )}
              {canManageActiveView && (
                <button
                  className="danger-menu-item"
                  role="menuitem"
                  type="button"
                  onClick={() => runAction(onDeleteView)}
                >
                  Delete View
                </button>
              )}
            </ContextMenu>
          </>
        ) : (
          <button
            className="view-save-button"
            type="button"
            onClick={() => setDialog('create')}
          >
            <Save aria-hidden="true" size={14} /> Save View
          </button>
        )}
      </div>

      {dialog && (
        <SavedViewDialog
          title={dialogTitle(dialog)}
          initialName={
            dialog === 'duplicate'
              ? `${activeView?.name ?? 'View'} copy`
              : (activeView?.name ?? '')
          }
          initialVisibility={
            dialog === 'rename'
              ? (activeView?.visibility ?? 'personal')
              : 'personal'
          }
          showVisibility={dialog !== 'rename'}
          canShare={canShare}
          submitLabel={dialog === 'rename' ? 'Save' : 'Create View'}
          onClose={() => setDialog(null)}
          onSubmit={(name, visibility) => {
            if (dialog === 'rename') {
              return onUpdateView({ name, visibility });
            }
            if (dialog === 'duplicate') {
              return onDuplicateView(name, visibility);
            }
            return onCreateView(name, visibility);
          }}
        />
      )}
    </>
  );
}

function MenuHeading({ children }: { children: string }) {
  return <p className="view-menu-heading">{children}</p>;
}

function CheckMenuItem({
  checked,
  label,
  onClick,
}: {
  checked: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      data-menu-keep-open
      role="menuitemcheckbox"
      aria-checked={checked}
      type="button"
      onClick={onClick}
    >
      <span className="view-menu-check" aria-hidden="true">
        {checked ? '✓' : ''}
      </span>
      {label}
    </button>
  );
}

function DateRangeControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: DateFilter;
  onChange: (value: DateFilter) => void;
}) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <label>
        <span>From</span>
        <input
          type="date"
          value={value.from ?? ''}
          onChange={(event) =>
            onChange({ ...value, from: event.target.value || null })
          }
        />
      </label>
      <label>
        <span>To</span>
        <input
          type="date"
          value={value.to ?? ''}
          onChange={(event) =>
            onChange({ ...value, to: event.target.value || null })
          }
        />
      </label>
      <label className="view-range-check">
        <input
          type="checkbox"
          checked={value.include_none}
          onChange={() =>
            onChange({ ...value, include_none: !value.include_none })
          }
        />
        Include unscheduled
      </label>
    </fieldset>
  );
}

function optionalNumber(value: string) {
  return value ? Number(value) : null;
}

function dialogTitle(mode: Exclude<ViewDialogMode, null>) {
  if (mode === 'rename') return 'Rename View';
  if (mode === 'duplicate') return 'Duplicate View';
  return 'Save current View';
}

function labelFor(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
