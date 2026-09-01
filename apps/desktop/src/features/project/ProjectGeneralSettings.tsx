import { useState, type FormEvent } from 'react';
import { Select } from '../../components/ui/Select';
import { SettingsArticle } from '../settings/SettingsArticle';
import { FormActions, type ActionState } from '../settings/SettingsControls';
import { errorMessage } from '../settings/utils';
import { updateProject, type ApiContext } from '../workspace/api';
import type { Project, ProjectMember } from '../workspace/types';

interface ProjectGeneralSettingsProps {
  context: ApiContext;
  project: Project;
  members: ProjectMember[];
  membersLoading: boolean;
  onUpdated: (project: Project) => Promise<void>;
}

export function ProjectGeneralSettings({
  context,
  project,
  members,
  membersLoading,
  onUpdated,
}: ProjectGeneralSettingsProps) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [visibility, setVisibility] = useState(project.visibility);
  const [leadUserId, setLeadUserId] = useState(project.lead_user_id ?? '');
  const [state, setState] = useState<ActionState>({ status: 'idle' });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState({ status: 'saving' });
    try {
      const updated = await updateProject(
        context,
        project.workspace_id,
        project.id,
        {
          name,
          description,
          visibility,
          lead_user_id: leadUserId || null,
        },
      );
      await onUpdated(updated);
      setState({ status: 'saved', message: 'Project details saved.' });
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  return (
    <SettingsArticle
      eyebrow="Project"
      title="General"
      description="Identity, ownership, description, and Workspace visibility."
    >
      <form className="settings-form" onSubmit={(event) => void submit(event)}>
        <label className="settings-field">
          <span>Name</span>
          <input
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="settings-field">
          <span>Project ID</span>
          <input readOnly value={project.identifier} />
          <small>
            This stable ID is used in Project links and cannot change.
          </small>
        </label>
        <label className="settings-field">
          <span>Description</span>
          <textarea
            rows={5}
            maxLength={2000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="settings-field">
          <span>Visibility</span>
          <Select
            ariaLabel="Visibility"
            value={visibility}
            options={[
              { value: 'private', label: 'Private — members only' },
              {
                value: 'public',
                label: 'Public — Workspace Members can discover and join',
              },
            ]}
            onValueChange={(value) =>
              setVisibility(value as Project['visibility'])
            }
          />
        </label>
        <label className="settings-field">
          <span>Project lead</span>
          <Select
            ariaLabel="Project lead"
            value={leadUserId}
            disabled={membersLoading}
            options={[
              { value: '', label: 'No lead' },
              ...members
                .filter(({ role }) => role === 'admin')
                .map((member) => ({
                  value: member.user_id,
                  label: member.display_name,
                })),
            ]}
            onValueChange={setLeadUserId}
          />
          <small>The lead must have Project Admin access.</small>
        </label>
        <FormActions state={state} label="Save general settings" />
      </form>
    </SettingsArticle>
  );
}
