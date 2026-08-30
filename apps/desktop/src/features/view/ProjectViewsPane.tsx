import { ArrowRight, Bookmark, Plus } from 'lucide-react';
import { useState } from 'react';
import type { Project } from '../workspace/types';
import { SavedViewDialog } from './SavedViewDialog';
import type { SavedView, SavedViewVisibility, TaskLayout } from './types';

interface ProjectViewsPaneProps {
  project: Project;
  views: SavedView[];
  loading: boolean;
  error: string | null;
  canShare: boolean;
  onCreate: (name: string, visibility: SavedViewVisibility) => Promise<void>;
  onOpen: (view: SavedView) => void;
  onRetry: () => void;
}

export function ProjectViewsPane({
  project,
  views,
  loading,
  error,
  canShare,
  onCreate,
  onOpen,
  onRetry,
}: ProjectViewsPaneProps) {
  const [creating, setCreating] = useState(false);
  const personalViews = views.filter(
    ({ visibility }) => visibility === 'personal',
  );
  const sharedViews = views.filter(({ visibility }) => visibility === 'shared');

  return (
    <section
      className="project-surface project-views-surface"
      aria-labelledby="project-views-heading"
    >
      <header className="project-views-header">
        <div>
          <p className="pane-eyebrow">{project.identifier} · Project</p>
          <h1 id="project-views-heading">Views</h1>
          <p>Saved filters, grouping, fields, and layouts for this Project.</p>
        </div>
        <button
          className="primary-button compact-button"
          type="button"
          onClick={() => setCreating(true)}
        >
          <Plus aria-hidden="true" size={15} /> New View
        </button>
      </header>

      <div className="project-views-body">
        {loading ? (
          <p className="project-views-state" role="status">
            Loading Views…
          </p>
        ) : error ? (
          <div className="project-views-state" role="alert">
            <p>{error}</p>
            <button
              className="secondary-button"
              type="button"
              onClick={onRetry}
            >
              Try again
            </button>
          </div>
        ) : views.length === 0 ? (
          <div className="project-views-empty">
            <Bookmark aria-hidden="true" size={20} />
            <h2>No saved Views</h2>
            <p>
              Save a focused task collection, then refine its filters and
              layout.
            </p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setCreating(true)}
            >
              <Plus aria-hidden="true" size={14} /> Create the first View
            </button>
          </div>
        ) : (
          <div className="project-view-groups">
            <ViewGroup
              label="Shared"
              description="Available to everyone with Project access."
              views={sharedViews}
              onOpen={onOpen}
            />
            <ViewGroup
              label="Personal"
              description="Visible only to you."
              views={personalViews}
              onOpen={onOpen}
            />
          </div>
        )}
      </div>

      {creating && (
        <SavedViewDialog
          title={`New ${project.name} View`}
          initialName=""
          initialVisibility="personal"
          canShare={canShare}
          submitLabel="Create View"
          onClose={() => setCreating(false)}
          onSubmit={onCreate}
        />
      )}
    </section>
  );
}

function ViewGroup({
  label,
  description,
  views,
  onOpen,
}: {
  label: string;
  description: string;
  views: SavedView[];
  onOpen: (view: SavedView) => void;
}) {
  if (views.length === 0) return null;
  const headingId = `project-${label.toLowerCase()}-views`;
  return (
    <section className="project-view-group" aria-labelledby={headingId}>
      <header>
        <div>
          <h2 id={headingId}>{label}</h2>
          <p>{description}</p>
        </div>
        <span>{views.length}</span>
      </header>
      <div className="project-view-list">
        {views.map((view) => (
          <button type="button" key={view.id} onClick={() => onOpen(view)}>
            <Bookmark aria-hidden="true" size={15} />
            <span>
              <strong>{view.name}</strong>
              <small>{layoutLabel(view.layout)} layout</small>
            </span>
            <ArrowRight aria-hidden="true" size={14} />
          </button>
        ))}
      </div>
    </section>
  );
}

function layoutLabel(layout: TaskLayout) {
  return layout.charAt(0).toUpperCase() + layout.slice(1);
}
