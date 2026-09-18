import { ArrowRight, Webhook } from 'lucide-react';
import type { MouseEventHandler } from 'react';
import { Link } from 'react-router';
import { routePaths } from '../../app/routing/routePaths';
import type { Workspace } from '../workspace/types';
import { DeveloperPage } from './DeveloperPage';

export function DeveloperOverview({
  workspace,
  onNavigate,
}: {
  workspace: Workspace;
  onNavigate: MouseEventHandler<HTMLAnchorElement>;
}) {
  return (
    <DeveloperPage
      title="Developer overview"
      description="Manage developer tools and automation for this Workspace."
    >
      <section className="developer-feature-row">
        <Webhook aria-hidden="true" size={20} />
        <div>
          <h2>Webhooks</h2>
          <p>Send Workspace events to external services.</p>
          <Link
            className="developer-text-link"
            to={routePaths.developerWebhooks(workspace.identifier)}
            onClick={onNavigate}
          >
            Open Webhooks <ArrowRight aria-hidden="true" size={14} />
          </Link>
        </div>
      </section>
    </DeveloperPage>
  );
}
