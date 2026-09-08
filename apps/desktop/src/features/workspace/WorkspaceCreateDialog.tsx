import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import type { ApiContext } from './api';
import { InvitationComposer } from './InvitationComposer';
import type { Workspace } from './types';
import {
  WorkspaceIdentityForm,
  type WorkspaceIdentity,
} from './WorkspaceIdentityForm';

interface WorkspaceCreateDialogProps {
  context: ApiContext;
  onCreate: (identity: WorkspaceIdentity) => Promise<Workspace>;
  onFinished: (workspace: Workspace) => void | Promise<void>;
  onClose: () => void;
}

export function WorkspaceCreateDialog({
  context,
  onCreate,
  onFinished,
  onClose,
}: WorkspaceCreateDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stageHeadingRef = useRef<HTMLHeadingElement>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [creating, setCreating] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [invitationCount, setInvitationCount] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  useEffect(() => {
    if (workspace) stageHeadingRef.current?.focus();
  }, [workspace]);

  function close() {
    if (creating || finishing || workspace) return;
    onClose();
  }

  async function create(identity: WorkspaceIdentity) {
    setCreating(true);
    try {
      const created = await onCreate(identity);
      setWorkspace(created);
    } finally {
      setCreating(false);
    }
  }

  async function finish() {
    if (!workspace) return;
    setFinishing(true);
    try {
      await onFinished(workspace);
    } finally {
      setFinishing(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="workspace-create-dialog"
      aria-labelledby="workspace-create-heading"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="workspace-create-window">
        <header>
          <div>
            <span className="dialog-step-label">
              Step {workspace ? '2' : '1'} of 2
            </span>
            <h2
              ref={stageHeadingRef}
              id="workspace-create-heading"
              tabIndex={workspace ? -1 : undefined}
            >
              {workspace
                ? `Invite people to ${workspace.name}`
                : 'Create a Workspace'}
            </h2>
            <small>
              {workspace
                ? 'Invitations are optional and can be managed later.'
                : 'Choose a name and permanent public Workspace ID.'}
            </small>
          </div>
          {!workspace ? (
            <IconButton
              variant="ghost"
              size="sm"
              type="button"
              aria-label="Close Workspace creation"
              disabled={creating}
              onClick={close}
            >
              <X aria-hidden="true" size={16} />
            </IconButton>
          ) : null}
        </header>
        <div className="workspace-create-content">
          {workspace ? (
            <>
              <div className="workspace-created-summary">
                <span className="workspace-trigger-mark" aria-hidden="true">
                  {workspace.name.trim().charAt(0).toUpperCase() || 'W'}
                </span>
                <span>
                  <strong>{workspace.name}</strong>
                  <small>/{workspace.identifier}</small>
                </span>
              </div>
              <InvitationComposer
                context={context}
                workspaceId={workspace.id}
                onInvitationCreated={() =>
                  setInvitationCount((count) => count + 1)
                }
              />
            </>
          ) : (
            <WorkspaceIdentityForm
              submitLabel="Create Workspace"
              onSubmit={create}
              onCancel={close}
            />
          )}
        </div>
        {workspace ? (
          <footer>
            <Button
              variant="primary"
              size="sm"
              type="button"
              loading={finishing}
              loadingLabel="Opening Workspace"
              onClick={() => void finish()}
            >
              {invitationCount > 0 ? 'Done' : 'Skip invitations'}
            </Button>
          </footer>
        ) : null}
      </div>
    </dialog>
  );
}
