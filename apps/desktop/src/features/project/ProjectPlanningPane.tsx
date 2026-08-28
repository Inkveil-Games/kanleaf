import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, CalendarRange, Layers3, Plus } from 'lucide-react';
import { useState } from 'react';
import {
  archiveProjectCycle,
  archiveProjectModule,
  completeProjectCycle,
  createProjectCycle,
  createProjectModule,
  listPlanningTasks,
  listProjectCycles,
  listProjectModules,
  updateProjectCycle,
  updateProjectModule,
  type ApiContext,
} from '../workspace/api';
import type {
  Project,
  ProjectCycle,
  ProjectCyclePatch,
  ProjectMember,
  ProjectModule,
  ProjectModulePatch,
  ProjectModuleStatus,
} from '../workspace/types';

export type PlanningKind = 'cycles' | 'modules';

interface ProjectPlanningPaneProps {
  context: ApiContext;
  workspaceId: string;
  project: Project;
  members: ProjectMember[];
  kind: PlanningKind;
  onOpenTask: (taskId: string) => void;
}

export function ProjectPlanningPane({
  context,
  workspaceId,
  project,
  members,
  kind,
  onOpenTask,
}: ProjectPlanningPaneProps) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const canEdit =
    project.effective_role === 'admin' ||
    project.effective_role === 'contributor';
  const canManage = project.effective_role === 'admin';
  const queryKey = [kind, workspaceId, project.id];
  const cycles = useQuery({
    queryKey: ['cycles', workspaceId, project.id],
    queryFn: () => listProjectCycles(context, workspaceId, project.id),
    enabled: kind === 'cycles',
  });
  const modules = useQuery({
    queryKey: ['modules', workspaceId, project.id],
    queryFn: () => listProjectModules(context, workspaceId, project.id),
    enabled: kind === 'modules',
  });
  const items = kind === 'cycles' ? (cycles.data ?? []) : (modules.data ?? []);
  const selected =
    items.find(({ id }) => id === selectedId) ?? items[0] ?? null;
  const effectiveSelectedId = selected?.id ?? null;
  const selectedFilter = selected
    ? kind === 'cycles'
      ? { cycleId: selected.id }
      : { moduleId: selected.id }
    : null;
  const tasks = useQuery({
    queryKey: ['tasks', workspaceId, kind, effectiveSelectedId],
    queryFn: () => listPlanningTasks(context, workspaceId, selectedFilter!),
    enabled: Boolean(selectedFilter),
  });

  async function refreshPlanning() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      queryClient.invalidateQueries({ queryKey: ['tasks', workspaceId] }),
    ]);
  }

  async function createCycle(values: {
    name: string;
    start_date: string;
    due_date: string;
  }) {
    const created = await createProjectCycle(
      context,
      workspaceId,
      project.id,
      values,
    );
    await refreshPlanning();
    setSelectedId(created.id);
    setCreating(false);
  }

  async function createModule(name: string) {
    const created = await createProjectModule(
      context,
      workspaceId,
      project.id,
      { name },
    );
    await refreshPlanning();
    setSelectedId(created.id);
    setCreating(false);
  }

  async function updateCycle(cycleId: string, patch: ProjectCyclePatch) {
    await updateProjectCycle(context, workspaceId, project.id, cycleId, patch);
    await refreshPlanning();
  }

  async function updateModule(moduleId: string, patch: ProjectModulePatch) {
    await updateProjectModule(
      context,
      workspaceId,
      project.id,
      moduleId,
      patch,
    );
    await refreshPlanning();
  }

  async function archiveSelected() {
    if (!selected || !window.confirm(`Archive ${selected.name}?`)) return;
    if (kind === 'cycles') {
      await archiveProjectCycle(context, workspaceId, project.id, selected.id);
    } else {
      await archiveProjectModule(context, workspaceId, project.id, selected.id);
    }
    setSelectedId(null);
    await refreshPlanning();
  }

  async function run(action: () => Promise<void>) {
    setActionError(null);
    try {
      await action();
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  const loading = kind === 'cycles' ? cycles.isPending : modules.isPending;
  const loadError = kind === 'cycles' ? cycles.error : modules.error;

  return (
    <section className="planning-surface" aria-label={`Project ${kind}`}>
      <section className="planning-list-pane">
        <header className="collection-header">
          <div>
            <p className="pane-eyebrow">{project.identifier}</p>
            <h1>{kind === 'cycles' ? 'Cycles' : 'Modules'}</h1>
          </div>
          {canEdit && (
            <button
              className="icon-button strong-icon-button"
              type="button"
              aria-label={`New ${kind === 'cycles' ? 'cycle' : 'module'}`}
              onClick={() => setCreating(true)}
            >
              <Plus aria-hidden="true" size={17} />
            </button>
          )}
        </header>
        {creating &&
          (kind === 'cycles' ? (
            <CycleCreateForm
              onCancel={() => setCreating(false)}
              onSubmit={(values) => run(() => createCycle(values))}
            />
          ) : (
            <ModuleCreateForm
              onCancel={() => setCreating(false)}
              onSubmit={(name) => run(() => createModule(name))}
            />
          ))}
        <div className="planning-list" role="listbox" aria-label={kind}>
          {loading && <p className="pane-state">Loading {kind}…</p>}
          {loadError && (
            <p className="pane-state" role="alert">
              {errorMessage(loadError)}
            </p>
          )}
          {!loading && !loadError && items.length === 0 && (
            <div className="pane-state empty-state">
              <p>No {kind} yet.</p>
              {canEdit && (
                <button type="button" onClick={() => setCreating(true)}>
                  Create the first {kind === 'cycles' ? 'Cycle' : 'Module'}
                </button>
              )}
            </div>
          )}
          {items.map((item) => (
            <button
              className="planning-row"
              key={item.id}
              type="button"
              role="option"
              aria-selected={item.id === effectiveSelectedId}
              onClick={() => setSelectedId(item.id)}
            >
              {kind === 'cycles' ? (
                <CalendarRange aria-hidden="true" size={15} />
              ) : (
                <Layers3 aria-hidden="true" size={15} />
              )}
              <span>
                <strong>{item.name}</strong>
                <small>{planningRowMeta(item)}</small>
              </span>
              <span className="planning-row-count">
                {item.completed_tasks}/{item.total_tasks}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="planning-detail-pane">
        {!selected ? (
          <div className="planning-empty-detail">
            {kind === 'cycles' ? (
              <CalendarRange aria-hidden="true" size={23} />
            ) : (
              <Layers3 aria-hidden="true" size={23} />
            )}
            <h2>Select a {kind === 'cycles' ? 'Cycle' : 'Module'}</h2>
            <p>Planning details and linked work items will appear here.</p>
          </div>
        ) : (
          <div className="planning-detail-scroll">
            <header className="planning-detail-header">
              <div>
                <p className="pane-eyebrow">
                  {kind === 'cycles'
                    ? statusLabel((selected as ProjectCycle).status)
                    : statusLabel((selected as ProjectModule).status)}
                </p>
                <h2>{selected.name}</h2>
              </div>
              {canManage && (
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Archive ${selected.name}`}
                  onClick={() => void run(archiveSelected)}
                >
                  <Archive aria-hidden="true" size={15} />
                </button>
              )}
            </header>

            <ProgressSummary item={selected} />

            {kind === 'cycles' ? (
              <CycleEditor
                key={selected.id}
                cycle={selected as ProjectCycle}
                cycles={cycles.data ?? []}
                canEdit={canEdit}
                onSave={(patch) => run(() => updateCycle(selected.id, patch))}
                onComplete={(transferId) =>
                  run(async () => {
                    await completeProjectCycle(
                      context,
                      workspaceId,
                      project.id,
                      selected.id,
                      transferId,
                    );
                    await refreshPlanning();
                  })
                }
              />
            ) : (
              <ModuleEditor
                key={selected.id}
                module={selected as ProjectModule}
                members={members}
                canEdit={canEdit}
                onSave={(patch) => run(() => updateModule(selected.id, patch))}
              />
            )}

            {actionError && (
              <p className="detail-error" role="alert">
                {actionError}
              </p>
            )}

            <section
              className="planning-task-section"
              aria-labelledby="planning-work-title"
            >
              <header>
                <h3 id="planning-work-title">Work items</h3>
                <span>{tasks.data?.length ?? 0}</span>
              </header>
              {tasks.isPending && <p>Loading work items…</p>}
              {tasks.error && <p role="alert">{errorMessage(tasks.error)}</p>}
              {tasks.data?.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onOpenTask(task.id)}
                >
                  <span>{task.reference}</span>
                  <strong>{task.title}</strong>
                  <small>{task.state.name}</small>
                </button>
              ))}
              {tasks.data?.length === 0 && <p>No linked work items.</p>}
            </section>
          </div>
        )}
      </section>
    </section>
  );
}

function CycleCreateForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (values: {
    name: string;
    start_date: string;
    due_date: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(today());
  const [dueDate, setDueDate] = useState(daysFromToday(13));
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="planning-create-form"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        void onSubmit({
          name: name.trim(),
          start_date: startDate,
          due_date: dueDate,
        }).finally(() => setSaving(false));
      }}
    >
      <input
        autoFocus
        required
        maxLength={120}
        aria-label="Cycle name"
        placeholder="Cycle name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <label>
        <span>Start</span>
        <input
          required
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
        />
      </label>
      <label>
        <span>Due</span>
        <input
          required
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
        />
      </label>
      <div>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={saving || !name.trim()}>
          {saving ? 'Creating…' : 'Create'}
        </button>
      </div>
    </form>
  );
}

function ModuleCreateForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="planning-create-form compact"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        void onSubmit(name.trim()).finally(() => setSaving(false));
      }}
    >
      <input
        autoFocus
        required
        maxLength={120}
        aria-label="Module name"
        placeholder="Module name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <div>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={saving || !name.trim()}>
          {saving ? 'Creating…' : 'Create'}
        </button>
      </div>
    </form>
  );
}

function ProgressSummary({ item }: { item: ProjectCycle | ProjectModule }) {
  const percentage = item.total_tasks
    ? Math.round((item.completed_tasks / item.total_tasks) * 100)
    : 0;
  return (
    <section className="planning-progress" aria-label="Progress">
      <div>
        <strong>{percentage}%</strong>
        <span>
          {item.completed_tasks} of {item.total_tasks} work items complete
        </span>
      </div>
      <progress
        value={item.completed_tasks}
        max={Math.max(item.total_tasks, 1)}
      />
      <small>
        {item.completed_estimate} of {item.total_estimate} estimate completed
      </small>
    </section>
  );
}

function CycleEditor({
  cycle,
  cycles,
  canEdit,
  onSave,
  onComplete,
}: {
  cycle: ProjectCycle;
  cycles: ProjectCycle[];
  canEdit: boolean;
  onSave: (patch: ProjectCyclePatch) => Promise<void>;
  onComplete: (transferId: string | null) => Promise<void>;
}) {
  const [name, setName] = useState(cycle.name);
  const [description, setDescription] = useState(cycle.description);
  const [startDate, setStartDate] = useState(cycle.start_date);
  const [dueDate, setDueDate] = useState(cycle.due_date);
  const [transferId, setTransferId] = useState('');
  const [saving, setSaving] = useState(false);
  const futureCycles = cycles.filter(
    (candidate) =>
      candidate.id !== cycle.id &&
      candidate.status !== 'completed' &&
      candidate.start_date > cycle.due_date,
  );
  return (
    <form
      className="planning-editor"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        void onSave({
          name: name.trim(),
          description,
          start_date: startDate,
          due_date: dueDate,
        }).finally(() => setSaving(false));
      }}
    >
      <PlanningFields
        name={name}
        description={description}
        startDate={startDate}
        dueDate={dueDate}
        disabled={!canEdit || cycle.status === 'completed'}
        datesRequired
        onName={setName}
        onDescription={setDescription}
        onStartDate={setStartDate}
        onDueDate={setDueDate}
      />
      {canEdit && cycle.status !== 'completed' && (
        <div className="planning-editor-actions">
          <button
            className="secondary-button"
            type="submit"
            disabled={saving || !name.trim()}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <div className="cycle-complete-control">
            <select
              aria-label="Transfer incomplete work"
              value={transferId}
              onChange={(event) => setTransferId(event.target.value)}
            >
              <option value="">Leave incomplete work unassigned</option>
              {futureCycles.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  Transfer to {candidate.name}
                </option>
              ))}
            </select>
            <button
              className="primary-button compact-button"
              type="button"
              onClick={() => void onComplete(transferId || null)}
            >
              Complete Cycle
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

function ModuleEditor({
  module,
  members,
  canEdit,
  onSave,
}: {
  module: ProjectModule;
  members: ProjectMember[];
  canEdit: boolean;
  onSave: (patch: ProjectModulePatch) => Promise<void>;
}) {
  const [name, setName] = useState(module.name);
  const [description, setDescription] = useState(module.description);
  const [status, setStatus] = useState(module.status);
  const [leadId, setLeadId] = useState(module.lead_user_id ?? '');
  const [startDate, setStartDate] = useState(module.start_date ?? '');
  const [dueDate, setDueDate] = useState(module.due_date ?? '');
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="planning-editor"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        void onSave({
          name: name.trim(),
          description,
          status,
          lead_user_id: leadId || null,
          start_date: startDate || null,
          due_date: dueDate || null,
        }).finally(() => setSaving(false));
      }}
    >
      <PlanningFields
        name={name}
        description={description}
        startDate={startDate}
        dueDate={dueDate}
        disabled={!canEdit}
        onName={setName}
        onDescription={setDescription}
        onStartDate={setStartDate}
        onDueDate={setDueDate}
      />
      <div className="planning-field-row">
        <label>
          <span>Status</span>
          <select
            disabled={!canEdit}
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as ProjectModuleStatus)
            }
          >
            {MODULE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {statusLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Lead</span>
          <select
            disabled={!canEdit}
            value={leadId}
            onChange={(event) => setLeadId(event.target.value)}
          >
            <option value="">No lead</option>
            {members.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.display_name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {canEdit && (
        <div className="planning-editor-actions">
          <button
            className="secondary-button"
            type="submit"
            disabled={saving || !name.trim()}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </form>
  );
}

function PlanningFields({
  name,
  description,
  startDate,
  dueDate,
  disabled,
  datesRequired = false,
  onName,
  onDescription,
  onStartDate,
  onDueDate,
}: {
  name: string;
  description: string;
  startDate: string;
  dueDate: string;
  disabled: boolean;
  datesRequired?: boolean;
  onName: (value: string) => void;
  onDescription: (value: string) => void;
  onStartDate: (value: string) => void;
  onDueDate: (value: string) => void;
}) {
  return (
    <>
      <label>
        <span>Name</span>
        <input
          required
          maxLength={120}
          disabled={disabled}
          value={name}
          onChange={(event) => onName(event.target.value)}
        />
      </label>
      <label>
        <span>Description</span>
        <textarea
          rows={4}
          maxLength={2000}
          disabled={disabled}
          value={description}
          onChange={(event) => onDescription(event.target.value)}
        />
      </label>
      <div className="planning-field-row">
        <label>
          <span>Start date</span>
          <input
            required={datesRequired}
            type="date"
            disabled={disabled}
            value={startDate}
            onChange={(event) => onStartDate(event.target.value)}
          />
        </label>
        <label>
          <span>Due date</span>
          <input
            required={datesRequired}
            type="date"
            disabled={disabled}
            value={dueDate}
            onChange={(event) => onDueDate(event.target.value)}
          />
        </label>
      </div>
    </>
  );
}

const MODULE_STATUSES: ProjectModuleStatus[] = [
  'backlog',
  'planned',
  'in_progress',
  'paused',
  'completed',
  'canceled',
];

function planningRowMeta(item: ProjectCycle | ProjectModule) {
  if ('completed_at' in item) {
    return `${statusLabel(item.status)} · ${shortDate(item.start_date)}–${shortDate(item.due_date)}`;
  }
  return `${statusLabel(item.status)}${item.due_date ? ` · due ${shortDate(item.due_date)}` : ''}`;
}

function statusLabel(status: string) {
  return status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${value}T00:00:00`));
}

function today() {
  return localDate(new Date());
}

function daysFromToday(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDate(date);
}

function localDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Planning update failed';
}
