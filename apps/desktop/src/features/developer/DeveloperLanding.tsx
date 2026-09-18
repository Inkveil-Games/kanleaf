import { ArrowRight } from 'lucide-react';
import type { MouseEventHandler } from 'react';
import { Link } from 'react-router';
import { routePaths } from '../../app/routing/routePaths';
import type { Workspace } from '../workspace/types';
import { DeveloperPage } from './DeveloperPage';

export function DeveloperLanding({
  workspaces,
  onNavigate,
}: {
  workspaces: Workspace[];
  onNavigate: MouseEventHandler<HTMLAnchorElement>;
}) {
  return (
    <DeveloperPage
      title="Developer console"
      description="Manage developer tools and automation for your Workspaces."
    >
      <section aria-labelledby="developer-workspaces-title">
        <h2 id="developer-workspaces-title">Choose a Workspace</h2>
        <p>Workspaces where you are an Owner or Admin appear here.</p>
        {workspaces.length ? (
          <ul className="developer-entry-list">
            {workspaces.map((workspace) => (
              <li key={workspace.id}>
                <Link
                  className="developer-entry"
                  to={routePaths.developerWorkspace(workspace.identifier)}
                  onClick={onNavigate}
                >
                  <span>
                    <strong>{workspace.name}</strong>
                    <small>
                      /{workspace.identifier} · {workspace.role}
                    </small>
                  </span>
                  <ArrowRight aria-hidden="true" size={16} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="developer-empty" role="status">
            <h3>No Workspaces to manage</h3>
            <p>
              Ask a Workspace Owner to grant you Admin access, or switch to an
              account that manages a Workspace.
            </p>
          </div>
        )}
      </section>
    </DeveloperPage>
  );
}
