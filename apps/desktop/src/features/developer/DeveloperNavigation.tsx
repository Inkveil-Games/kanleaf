import { ArrowLeft, House, PanelLeft, Webhook } from 'lucide-react';
import type { MouseEventHandler, ReactNode, RefObject } from 'react';
import { Link } from 'react-router';
import { routePaths } from '../../app/routing/routePaths';
import type { Workspace } from '../workspace/types';
import type { NavigationMode } from '../workspace/workspacePaneLayout';
import type { DeveloperSection } from './developerLocation';

interface DeveloperNavigationProps {
  workspace: Workspace | null;
  section: DeveloperSection | null;
  mode: NavigationMode;
  accountControl: ReactNode;
  workspaceControl: ReactNode;
  narrow: boolean;
  drawerOpen: boolean;
  toggleRef: RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
  onNavigate: MouseEventHandler<HTMLAnchorElement>;
}

export function DeveloperNavigation({
  workspace,
  section,
  mode,
  accountControl,
  workspaceControl,
  narrow,
  drawerOpen,
  toggleRef,
  onToggle,
  onNavigate,
}: DeveloperNavigationProps) {
  const compact = mode === 'rail';
  const items = workspace
    ? [
        {
          label: 'Overview',
          group: 'Overview',
          icon: House,
          section: 'overview',
          path: routePaths.developerWorkspace(workspace.identifier),
        },
        {
          label: 'Webhooks',
          group: 'Automation',
          icon: Webhook,
          section: 'webhooks',
          path: routePaths.developerWebhooks(workspace.identifier),
        },
      ]
    : [];
  return (
    <aside
      className={`navigation-pane${compact ? ' navigation-pane-rail' : ''}`}
    >
      <nav
        className={compact ? 'navigation-rail' : 'navigation-scroll'}
        aria-label="Developer navigation"
      >
        <div className={compact ? 'navigation-rail-actions' : undefined}>
          {compact ? (
            <>
              {workspaceControl}
              <button
                ref={toggleRef}
                type="button"
                className="navigation-rail-button"
                aria-label={narrow ? 'Open navigation' : 'Expand navigation'}
                aria-expanded={drawerOpen}
                aria-haspopup={narrow ? 'dialog' : undefined}
                aria-controls={
                  narrow ? 'workspace-navigation-drawer' : undefined
                }
                onClick={onToggle}
              >
                <PanelLeft aria-hidden="true" size={17} />
              </button>
            </>
          ) : (
            <p className="developer-navigation-title">Developer</p>
          )}
          {items.map(
            ({ label, group, icon: Icon, section: itemSection, path }) => (
              <section
                className={compact ? undefined : 'nav-section'}
                key={label}
              >
                {!compact && (
                  <div className="nav-section-heading">
                    <h2>{group}</h2>
                  </div>
                )}
                <Link
                  className={compact ? 'navigation-rail-button' : 'nav-button'}
                  aria-label={label}
                  title={compact ? label : undefined}
                  aria-current={
                    (
                      itemSection === 'webhooks'
                        ? section !== 'overview'
                        : section === itemSection
                    )
                      ? 'page'
                      : undefined
                  }
                  to={path}
                  onClick={onNavigate}
                >
                  <Icon aria-hidden="true" size={16} />
                  {!compact && <span>{label}</span>}
                </Link>
              </section>
            ),
          )}
        </div>
      </nav>
      <footer aria-label="Developer footer">
        <div className="developer-workspace-return">
          <Link
            className={compact ? 'navigation-rail-button' : 'nav-button'}
            aria-label="Back to Workspace"
            title={compact ? 'Back to Workspace' : undefined}
            to={
              workspace
                ? routePaths.workspaceMyWork(workspace.identifier)
                : routePaths.root()
            }
            onClick={onNavigate}
          >
            <ArrowLeft aria-hidden="true" size={16} />
            {!compact && <span>Back to Workspace</span>}
          </Link>
        </div>
        <div className="navigation-footer">{accountControl}</div>
      </footer>
    </aside>
  );
}
