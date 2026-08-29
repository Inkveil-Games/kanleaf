import { useState, type FormEvent } from 'react';
import { SettingsArticle } from '../settings/SettingsArticle';
import { FormActions, type ActionState } from '../settings/SettingsControls';
import { errorMessage } from '../settings/utils';
import { updateProject, type ApiContext } from '../workspace/api';
import type { Project } from '../workspace/types';

interface ProjectFeatureSettingsProps {
  context: ApiContext;
  project: Project;
  onUpdated: (project: Project) => Promise<void>;
}

export function ProjectFeatureSettings({
  context,
  project,
  onUpdated,
}: ProjectFeatureSettingsProps) {
  const [features, setFeatures] = useState({
    cycles_enabled: project.cycles_enabled,
    modules_enabled: project.modules_enabled,
    pages_enabled: project.pages_enabled,
    views_enabled: project.views_enabled,
  });
  const [state, setState] = useState<ActionState>({ status: 'idle' });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState({ status: 'saving' });
    try {
      const updated = await updateProject(
        context,
        project.workspace_id,
        project.id,
        features,
      );
      await onUpdated(updated);
      setState({ status: 'saved', message: 'Project features saved.' });
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  return (
    <SettingsArticle
      eyebrow="Project"
      title="Features"
      description="Keep each Project focused by enabling only the work surfaces it needs."
    >
      <form className="settings-form" onSubmit={(event) => void submit(event)}>
        <div className="settings-rows feature-toggle-rows">
          {(
            [
              ['cycles_enabled', 'Cycles', 'Time-boxed planning and review.'],
              [
                'modules_enabled',
                'Modules',
                'Group related work into larger outcomes.',
              ],
              [
                'pages_enabled',
                'Library',
                'Project-scoped access to the Workspace Markdown Library.',
              ],
              [
                'views_enabled',
                'Views',
                'Saved filters and alternative layouts. Planned for a later Core stage.',
              ],
            ] as const
          ).map(([key, label, description]) => (
            <label className="settings-row feature-toggle-row" key={key}>
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
              <input
                type="checkbox"
                checked={features[key]}
                onChange={(event) =>
                  setFeatures((current) => ({
                    ...current,
                    [key]: event.target.checked,
                  }))
                }
              />
            </label>
          ))}
        </div>
        <FormActions state={state} label="Save features" />
      </form>
    </SettingsArticle>
  );
}
