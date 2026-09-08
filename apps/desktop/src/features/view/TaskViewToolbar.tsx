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
import { Checkbox } from '../../components/ui/Checkbox';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import { Input } from '../../components/ui/Input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
} from '../../components/ui/DropdownMenu';
import { Popover } from '../../components/ui/Popover';
import { Select } from '../../components/ui/Select';
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
          <Select
            ariaLabel="Layout"
            value={layout}
            options={[
              { value: 'list', label: 'List' },
              { value: 'board', label: 'Board' },
              { value: 'calendar', label: 'Calendar' },
              { value: 'table', label: 'Table' },
              { value: 'timeline', label: 'Timeline' },
            ]}
            onValueChange={(value) => onLayoutChange(value as TaskLayout)}
          />
        </label>

        <DropdownMenu
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
        </DropdownMenu>

        <Popover
          label="Date and estimate filters"
          className="view-range-menu"
          trigger={<CalendarRange aria-hidden="true" size={14} />}
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
                <Input
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
                <Input
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
              <div className="view-range-check">
                <Checkbox
                  aria-label="Include unestimated Tasks"
                  checked={query.filters.estimate.include_none}
                  onCheckedChange={() =>
                    patchFilters({
                      estimate: {
                        ...query.filters.estimate,
                        include_none: !query.filters.estimate.include_none,
                      },
                    })
                  }
                />
                Include unestimated
              </div>
            </fieldset>
          </div>
        </Popover>

        <label className="view-compact-select">
          <Group aria-hidden="true" size={14} />
          <span className="sr-only">Group by</span>
          <Select
            ariaLabel="Group by"
            value={query.grouping.primary ?? ''}
            options={[{ value: '', label: 'No grouping' }, ...groupFields]}
            onValueChange={(value) =>
              onQueryChange({
                ...query,
                grouping: {
                  primary: (value || null) as TaskGroupField | null,
                  secondary: null,
                },
              })
            }
          />
        </label>
        {query.grouping.primary && (
          <label className="view-compact-select view-secondary-select">
            <span>then</span>
            <Select
              ariaLabel="Then group by"
              value={query.grouping.secondary ?? ''}
              options={[
                { value: '', label: 'No second group' },
                ...groupFields.filter(
                  ({ value }) => value !== query.grouping.primary,
                ),
              ]}
              onValueChange={(value) =>
                onQueryChange({
                  ...query,
                  grouping: {
                    ...query.grouping,
                    secondary: (value || null) as TaskGroupField | null,
                  },
                })
              }
            />
          </label>
        )}

        <label className="view-compact-select">
          <ArrowDownAZ aria-hidden="true" size={14} />
          <span className="sr-only">Sort by</span>
          <Select
            ariaLabel="Sort by"
            value={query.sort[0]?.field ?? ''}
            options={[
              { value: '', label: 'Manual' },
              { value: 'title', label: 'Title' },
              { value: 'priority', label: 'Priority' },
              { value: 'start_date', label: 'Start date' },
              { value: 'due_date', label: 'Due date' },
              { value: 'estimate', label: 'Estimate' },
              { value: 'updated_at', label: 'Updated' },
            ]}
            onValueChange={(value) => {
              const field = value as TaskSortField;
              onQueryChange({
                ...query,
                sort: field ? [{ field, direction: 'ascending' }] : [],
              });
            }}
          />
        </label>
        {query.sort[0] && (
          <>
            <IconButton
              className="view-sort-direction"
              variant="ghost"
              size="sm"
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
            </IconButton>
            <label className="view-compact-select view-secondary-select">
              <span>then</span>
              <Select
                ariaLabel="Then sort by"
                value={query.sort[1]?.field ?? ''}
                options={[
                  { value: '', label: 'No second sort' },
                  ...sortFields.filter(
                    ({ value }) => value !== query.sort[0]?.field,
                  ),
                ]}
                onValueChange={(value) => {
                  const field = value as TaskSortField;
                  onQueryChange({
                    ...query,
                    sort: field
                      ? [query.sort[0]!, { field, direction: 'ascending' }]
                      : [query.sort[0]!],
                  });
                }}
              />
            </label>
          </>
        )}

        <DropdownMenu
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
        </DropdownMenu>

        <span className="view-toolbar-spacer" />
        {activeView ? (
          <>
            {canManageActiveView && (
              <Button
                className="view-save-button"
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => runAction(onSaveViewConfiguration)}
              >
                <Save aria-hidden="true" size={14} /> Save changes
              </Button>
            )}
            <DropdownMenu
              label="Saved view actions"
              className="view-actions-menu"
            >
              {canManageActiveView && (
                <DropdownMenuItem onClick={() => setDialog('rename')}>
                  Rename
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setDialog('duplicate')}>
                Duplicate
              </DropdownMenuItem>
              {canChangeActiveViewVisibility &&
                (activeView.visibility === 'shared' || canShare) && (
                  <DropdownMenuItem
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
                  </DropdownMenuItem>
                )}
              {canManageActiveView && (
                <DropdownMenuItem
                  className="danger-menu-item"
                  onClick={() => runAction(onDeleteView)}
                >
                  Delete View
                </DropdownMenuItem>
              )}
            </DropdownMenu>
          </>
        ) : (
          <Button
            className="view-save-button"
            variant="secondary"
            size="sm"
            type="button"
            onClick={() => setDialog('create')}
          >
            <Save aria-hidden="true" size={14} /> Save View
          </Button>
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
    <DropdownMenuCheckboxItem
      checked={checked}
      onCheckedChange={() => onClick()}
    >
      <span className="view-menu-check" aria-hidden="true">
        {checked ? '✓' : ''}
      </span>
      {label}
    </DropdownMenuCheckboxItem>
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
        <Input
          type="date"
          value={value.from ?? ''}
          onChange={(event) =>
            onChange({ ...value, from: event.target.value || null })
          }
        />
      </label>
      <label>
        <span>To</span>
        <Input
          type="date"
          value={value.to ?? ''}
          onChange={(event) =>
            onChange({ ...value, to: event.target.value || null })
          }
        />
      </label>
      <div className="view-range-check">
        <Checkbox
          aria-label="Include unscheduled Tasks"
          checked={value.include_none}
          onCheckedChange={() =>
            onChange({ ...value, include_none: !value.include_none })
          }
        />
        Include unscheduled
      </div>
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
