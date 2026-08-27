import { useState, type FormEvent } from 'react';
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
  const [identifier, setIdentifier] = useState(project.identifier);
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
          identifier,
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
          <span>Identifier</span>
          <input
            required
            maxLength={12}
            value={identifier}
            onChange={(event) =>
              setIdentifier(event.target.value.toUpperCase())
            }
          />
          <small>Short stable code used to recognize this Project.</small>
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
          <select
            value={visibility}
            onChange={(event) =>
              setVisibility(event.target.value as Project['visibility'])
            }
          >
            <option value="private">Private — members only</option>
            <option value="open">
              Open — Workspace Members can discover and join
            </option>
          </select>
        </label>
        <label className="settings-field">
          <span>Project lead</span>
          <select
            value={leadUserId}
            disabled={membersLoading}
            onChange={(event) => setLeadUserId(event.target.value)}
          >
            <option value="">No lead</option>
            {members
              .filter(({ role }) => role === 'admin')
              .map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.display_name}
                </option>
              ))}
          </select>
          <small>The lead must have Project Admin access.</small>
        </label>
        <FormActions state={state} label="Save general settings" />
      </form>
    </SettingsArticle>
  );
}
