import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import { useLocation, useNavigate } from 'react-router';
import { routePaths, withTask } from '../../app/routing/routePaths';
import type { User } from '../../lib/api/types';
import { AccountSwitcher } from '../account/AccountSwitcher';
import { AppTopBar } from '../app-shell/AppTopBar';
import type { AccountSession } from '../auth/accountSessionStore';
import { errorMessage } from '../settings/utils';
import type { ApiContext } from '../workspace/api';
import { canManageWorkspace } from '../workspace/permissions';
import type { Workspace } from '../workspace/types';
import { WorkspaceControl } from '../workspace/WorkspaceControl';
import { WorkspaceNavigationDrawer } from '../workspace/WorkspaceNavigationDrawer';
import { PaneResizeHandle } from '../workspace/PaneResizeHandle';
import {
  PANE_LIMITS,
  useWorkspacePaneLayout,
  type NavigationMode,
} from '../workspace/workspacePaneLayout';
import { DeveloperLanding } from './DeveloperLanding';
import { DeveloperNavigation } from './DeveloperNavigation';
import { DeveloperOverview } from './DeveloperOverview';
import { DeveloperWebhooks } from './DeveloperWebhooks';
import { developerPath, type DeveloperSection } from './developerLocation';

export interface DeveloperShellProps {
  context: ApiContext;
  user: User;
  workspaces: Workspace[];
  workspace: Workspace | null;
  section: DeveloperSection | null;
  webhookId?: string;
  accountSessions: AccountSession[];
  accountTransitioning: boolean;
  accountError: string | null;
  onSwitchAccount: (userId: string) => void;
  onAddAccount: () => void;
  onOpenHostConsole?: () => void;
  onDismissAccountError: () => void;
  onSignOut: () => void;
  flushDocumentSaves: () => Promise<void>;
}

export function DeveloperShell(props: DeveloperShellProps) {
  const { context, workspace, workspaces, section, user } = props;
  const navigate = useNavigate();
  const location = useLocation();
  const paneLayout = useWorkspacePaneLayout();
  const shellRef = useRef<HTMLElement>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement>(null);
  const navigationIntent = useRef(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const eligible = useMemo(
    () => workspaces.filter(canManageWorkspace),
    [workspaces],
  );
  const accountWorkspace =
    workspace ??
    workspaces.find(({ id }) => id === user.active_workspace_id) ??
    workspaces[0];

  const closeNavigationDrawer = paneLayout.closeNavigationDrawer;
  const flushDocumentSaves = props.flushDocumentSaves;
  useEffect(
    () => () => {
      navigationIntent.current += 1;
    },
    [location.key],
  );

  const navigateSafely = useCallback(
    async (path: string) => {
      const intent = ++navigationIntent.current;
      setActionError(null);
      try {
        await flushDocumentSaves();
        if (intent !== navigationIntent.current) return;
        closeNavigationDrawer();
        navigate(path);
      } catch (caught) {
        if (intent === navigationIntent.current)
          setActionError(errorMessage(caught));
      }
    },
    [flushDocumentSaves, closeNavigationDrawer, navigate],
  );
  async function switchWorkspace(id: string) {
    const target = eligible.find((candidate) => candidate.id === id);
    if (target)
      await navigateSafely(
        developerPath(
          target.identifier,
          section && section !== 'overview' ? 'webhooks' : 'overview',
        ),
      );
  }
  function navigateLink(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    void navigateSafely(
      event.currentTarget.getAttribute('href') ?? routePaths.developer(),
    );
  }
  function openAccountSection(section: 'profile' | 'invitations') {
    void navigateSafely(
      accountWorkspace
        ? routePaths.accountSettings(accountWorkspace.identifier, section)
        : routePaths.root(),
    );
  }
  function renderControl(mode: NavigationMode) {
    return (
      <WorkspaceControl
        context={context}
        userEmail={user.email}
        workspaces={eligible}
        workspaceId={workspace?.id ?? null}
        mode={mode}
        onToggleNavigation={paneLayout.toggleNavigation}
        onSwitchWorkspace={switchWorkspace}
      />
    );
  }
  function renderNavigation(mode: NavigationMode) {
    return (
      <DeveloperNavigation
        mode={mode}
        workspace={workspace}
        section={section}
        narrow={paneLayout.narrow}
        drawerOpen={paneLayout.navigationMode === 'drawer'}
        toggleRef={drawerTriggerRef}
        onToggle={paneLayout.toggleNavigation}
        onNavigate={navigateLink}
        workspaceControl={mode === 'rail' ? renderControl('rail') : null}
        accountControl={
          <AccountSwitcher
            compact={mode === 'rail'}
            accounts={props.accountSessions}
            activeUserId={user.id}
            transitioning={props.accountTransitioning}
            error={props.accountError}
            onSwitchAccount={props.onSwitchAccount}
            onAddAccount={props.onAddAccount}
            onOpenAccountSettings={() => openAccountSection('profile')}
            onOpenHostConsole={
              props.onOpenHostConsole
                ? () => {
                    void flushDocumentSaves()
                      .then(props.onOpenHostConsole)
                      .catch((caught) => setActionError(errorMessage(caught)));
                  }
                : undefined
            }
            onSignOutCurrent={props.onSignOut}
            onDismissError={props.onDismissAccountError}
          />
        }
      />
    );
  }
  const inlineMode =
    paneLayout.navigationMode === 'expanded' ? 'expanded' : 'rail';
  return (
    <main
      ref={shellRef}
      className={`workspace-shell developer-shell${inlineMode === 'rail' ? ' navigation-rail-layout' : ''}${paneLayout.narrow ? ' is-narrow-window' : ''}`}
      style={
        {
          '--navigation-pane-width': `${paneLayout.navigationWidth}px`,
        } as CSSProperties
      }
      data-navigation-mode={paneLayout.navigationMode}
    >
      <AppTopBar
        context={context}
        area="Developer"
        onOpenInvitations={() => openAccountSection('invitations')}
        onOpenNotificationTask={(id, taskId) => {
          const target = workspaces.find((candidate) => candidate.id === id);
          if (target)
            void navigateSafely(
              withTask(routePaths.workspaceTasks(target.identifier), taskId),
            );
          else
            setActionError(
              'That Workspace is unavailable or you no longer have access.',
            );
        }}
      />
      {inlineMode === 'expanded' ? renderControl('expanded') : null}
      {renderNavigation(inlineMode)}
      {paneLayout.narrow ? (
        <WorkspaceNavigationDrawer
          navigationWidth={paneLayout.navigationWidth}
          open={paneLayout.navigationMode === 'drawer'}
          finalFocus={drawerTriggerRef}
          onOpenChange={(open) => {
            if (!open) paneLayout.closeNavigationDrawer();
          }}
        >
          {renderControl('drawer')}
          {renderNavigation('drawer')}
        </WorkspaceNavigationDrawer>
      ) : null}
      {!paneLayout.narrow && inlineMode === 'expanded' ? (
        <PaneResizeHandle
          className="navigation-resize-handle"
          label="Resize navigation"
          value={paneLayout.navigationWidth}
          limits={PANE_LIMITS.navigation}
          resizeTarget={shellRef}
          resizeProperty="--navigation-pane-width"
          onChange={paneLayout.setNavigationWidth}
        />
      ) : null}
      <div className="developer-content">
        {actionError ? (
          <p className="developer-action-error" role="alert">
            {actionError}
          </p>
        ) : null}
        {workspace ? (
          section !== 'overview' ? (
            <DeveloperWebhooks
              key={`${context.serverUrl}:${context.token}:${workspace.id}:${section}:${props.webhookId ?? ''}`}
              context={context}
              workspace={workspace}
              section={section ?? 'webhooks'}
              webhookId={props.webhookId}
              onNavigate={navigateLink}
              navigateTo={(path) => void navigateSafely(path)}
            />
          ) : (
            <DeveloperOverview
              workspace={workspace}
              onNavigate={navigateLink}
            />
          )
        ) : (
          <DeveloperLanding workspaces={eligible} onNavigate={navigateLink} />
        )}
      </div>
    </main>
  );
}
