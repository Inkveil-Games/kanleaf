import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/Button';
import { Checkbox } from '../../../components/ui/Checkbox';
import { FormField } from '../../../components/ui/FormField';
import { Input } from '../../../components/ui/Input';
import { Switch } from '../../../components/ui/Switch';
import { errorMessage } from '../../settings/utils';
import { listProjects, type ApiContext } from '../../workspace/api';
import type { Workspace } from '../../workspace/types';
import { getWebhookCatalog, webhookKey } from './api';
import type { Webhook, WebhookInput } from './types';
import { WebhookPreview } from './WebhookPreview';

const initial: WebhookInput = {
  name: '',
  endpoint_url: '',
  project_scope: 'all',
  project_ids: [],
  event_types: [],
  enabled: true,
};

export function WebhookForm({
  context,
  workspace,
  webhook,
  submitLabel,
  onSubmit,
}: {
  context: ApiContext;
  workspace: Workspace;
  webhook?: Webhook;
  submitLabel: string;
  onSubmit: (input: WebhookInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<WebhookInput>(() =>
    webhook
      ? {
          name: webhook.name,
          endpoint_url: webhook.endpoint_url,
          project_scope: webhook.project_scope,
          project_ids: webhook.projects.map(({ id }) => id),
          event_types: webhook.event_types,
          enabled: webhook.enabled,
        }
      : initial,
  );
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const projects = useQuery({
    queryKey: [
      'webhook-projects',
      context.serverUrl,
      context.token,
      workspace.id,
    ],
    queryFn: () => listProjects(context, workspace.id),
    refetchOnMount: 'always',
  });
  const previewProject =
    draft.project_scope === 'selected' ? draft.project_ids[0] : undefined;
  const catalog = useQuery({
    queryKey: [...webhookKey(context, workspace.id), 'catalog', previewProject],
    queryFn: () => getWebhookCatalog(context, workspace.id, previewProject),
  });
  const projectOptions = [
    ...(projects.data ?? []),
    ...(webhook?.projects ?? []).filter(
      (project) => !projects.data?.some(({ id }) => project.id === id),
    ),
  ];
  function change(patch: Partial<WebhookInput>) {
    setDraft((current) => ({ ...current, ...patch }));
    setSaved(false);
    setError(null);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const invalid: Record<string, string> = {};
    if (!draft.name.trim() || draft.name.length > 120)
      invalid.name = 'Enter a name of 1 to 120 characters.';
    try {
      const endpoint = new URL(draft.endpoint_url);
      if (
        !['https:', ...(catalog.data?.allow_http ? ['http:'] : [])].includes(
          endpoint.protocol,
        ) ||
        endpoint.username ||
        endpoint.password ||
        endpoint.hash
      )
        invalid.endpoint =
          'Enter a valid HTTPS endpoint without credentials or a fragment.';
    } catch {
      invalid.endpoint = 'Enter a valid endpoint URL.';
    }
    if (!draft.event_types.length)
      invalid.events = 'Select at least one event.';
    if (draft.project_scope === 'selected' && !draft.project_ids.length)
      invalid.projects = 'Select at least one Project.';
    setErrors(invalid);
    if (Object.keys(invalid).length) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        ...draft,
        name: draft.name.trim(),
        endpoint_url: draft.endpoint_url.trim(),
      });
      setSaved(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }
  if (projects.error || catalog.error)
    return (
      <div role="alert" className="settings-empty">
        <p>{errorMessage(projects.error ?? catalog.error)}</p>
        <Button
          onClick={() => {
            void projects.refetch();
            void catalog.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  if (!catalog.data || !projects.data)
    return <p role="status">Loading webhook configuration…</p>;
  return (
    <form
      className="webhook-form"
      onSubmit={(event) => void submit(event)}
      noValidate
      aria-label="Webhook configuration"
      aria-busy={busy}
    >
      <fieldset disabled={busy} className="webhook-configuration-fields">
        <FormField label="Name" required error={errors.name}>
          <Input
            value={draft.name}
            maxLength={120}
            onChange={(event) => change({ name: event.target.value })}
            autoComplete="off"
          />
        </FormField>
        <FormField
          label="Endpoint URL"
          required
          error={errors.endpoint}
          description={
            catalog.data.allow_http
              ? 'HTTPS is recommended. This instance also permits HTTP.'
              : 'Use an HTTPS endpoint that can receive JSON requests.'
          }
        >
          <Input
            type="url"
            value={draft.endpoint_url}
            onChange={(event) => change({ endpoint_url: event.target.value })}
            autoComplete="off"
            spellCheck={false}
          />
        </FormField>
        <fieldset className="webhook-scope">
          <legend>Project scope</legend>
          {(['all', 'selected'] as const).map((scope) => (
            <label key={scope}>
              <input
                type="radio"
                name="project-scope"
                value={scope}
                checked={draft.project_scope === scope}
                onChange={() =>
                  change({
                    project_scope: scope,
                    project_ids: scope === 'all' ? [] : draft.project_ids,
                  })
                }
              />
              {scope === 'all' ? 'All projects' : 'Selected projects'}
            </label>
          ))}
          {draft.project_scope === 'selected' ? (
            <div className="webhook-project-selection">
              <FormField label="Search Projects">
                <Input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </FormField>
              <div
                className="webhook-project-options"
                role="group"
                aria-label="Projects"
              >
                {projectOptions
                  .filter(({ name }) =>
                    name
                      .toLocaleLowerCase()
                      .includes(search.toLocaleLowerCase()),
                  )
                  .map((project) => (
                    <label key={project.id}>
                      <Checkbox
                        aria-label={project.name}
                        checked={draft.project_ids.includes(project.id)}
                        onCheckedChange={(checked) =>
                          change({
                            project_ids: checked
                              ? [...draft.project_ids, project.id]
                              : draft.project_ids.filter(
                                  (id) => id !== project.id,
                                ),
                          })
                        }
                      />
                      {project.name}
                    </label>
                  ))}
                {!projectOptions.length ? (
                  <p>
                    No Projects available. Create a Project in your Workspace
                    first.
                  </p>
                ) : null}
              </div>
              {errors.projects ? (
                <p role="alert" className="settings-error">
                  {errors.projects}
                </p>
              ) : null}
            </div>
          ) : null}
        </fieldset>
        <fieldset className="webhook-events">
          <legend>Events</legend>
          <div className="webhook-event-groups">
            {(['task', 'comment'] as const).map((group) => (
              <fieldset key={group}>
                <legend>{group === 'task' ? 'Tasks' : 'Comments'}</legend>
                {catalog.data.event_types
                  .filter((type) => type.startsWith(`${group}.`))
                  .map((type) => (
                    <label key={type}>
                      <Checkbox
                        checked={draft.event_types.includes(type)}
                        aria-label={`${group === 'task' ? 'Task' : 'Comment'} ${type.split('.')[1]}`}
                        onCheckedChange={(checked) =>
                          change({
                            event_types: checked
                              ? [...draft.event_types, type]
                              : draft.event_types.filter(
                                  (event) => event !== type,
                                ),
                          })
                        }
                      />
                      {type
                        .split('.')[1]
                        .replace(/^./, (letter) => letter.toUpperCase())}
                    </label>
                  ))}
              </fieldset>
            ))}
          </div>
          {errors.events ? (
            <p role="alert" className="settings-error">
              {errors.events}
            </p>
          ) : null}
        </fieldset>
        <label className="webhook-enabled">
          <span>Enabled</span>
          <Switch
            aria-label="Webhook enabled"
            checked={draft.enabled}
            onCheckedChange={(enabled) => change({ enabled })}
          />
        </label>
        <WebhookPreview catalog={catalog.data} selected={draft.event_types} />
      </fieldset>
      <div className="settings-form-actions">
        <Button variant="primary" size="sm" type="submit" loading={busy}>
          {submitLabel}
        </Button>
        {saved ? <span role="status">Changes saved</span> : null}
        {error ? (
          <span role="alert" className="settings-error">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
