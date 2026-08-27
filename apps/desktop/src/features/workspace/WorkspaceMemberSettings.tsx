import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserMinus } from 'lucide-react';
import { useState } from 'react';
import { SettingsArticle } from '../settings/SettingsArticle';
import { LoadError } from '../settings/SettingsControls';
import { errorMessage, monogram, titleCase } from '../settings/utils';
import {
  listWorkspaceMembers,
  removeWorkspaceMember,
  transferWorkspaceOwnership,
  updateWorkspaceMember,
  type ApiContext,
} from './api';
import { canManageWorkspace } from './permissions';
import type {
  AssignableWorkspaceRole,
  Workspace,
  WorkspaceMember,
} from './types';

interface WorkspaceMemberSettingsProps {
  context: ApiContext;
  workspace: Workspace;
  userId: string;
  onWorkspaceUpdated: () => Promise<void>;
}

export function WorkspaceMemberSettings({
  context,
  workspace,
  userId,
  onWorkspaceUpdated,
}: WorkspaceMemberSettingsProps) {
  const queryClient = useQueryClient();
  const members = useQuery({
    queryKey: ['workspace-members', workspace.id],
    queryFn: () => listWorkspaceMembers(context, workspace.id),
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyMember, setBusyMember] = useState<string | null>(null);
  const canManage = canManageWorkspace(workspace);

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: ['workspace-members', workspace.id],
    });
  }

  async function changeRole(
    member: WorkspaceMember,
    role: AssignableWorkspaceRole,
  ) {
    setBusyMember(member.user_id);
    setActionError(null);
    try {
      await updateWorkspaceMember(context, workspace.id, member.user_id, role);
      await Promise.all([refresh(), onWorkspaceUpdated()]);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyMember(null);
    }
  }

  async function remove(member: WorkspaceMember) {
    if (
      !window.confirm(`Remove ${member.display_name} from ${workspace.name}?`)
    ) {
      return;
    }
    setBusyMember(member.user_id);
    setActionError(null);
    try {
      await removeWorkspaceMember(context, workspace.id, member.user_id);
      await refresh();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyMember(null);
    }
  }

  async function transfer(member: WorkspaceMember) {
    if (
      !window.confirm(
        `Transfer ownership of ${workspace.name} to ${member.display_name}? You will become an Admin.`,
      )
    ) {
      return;
    }
    setBusyMember(member.user_id);
    setActionError(null);
    try {
      await transferWorkspaceOwnership(context, workspace.id, member.user_id);
      await Promise.all([refresh(), onWorkspaceUpdated()]);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyMember(null);
    }
  }

  return (
    <SettingsArticle
      eyebrow="Workspace"
      title="Members"
      description="People with access to this Workspace and their fixed roles."
    >
      {actionError && (
        <p className="settings-error" role="alert">
          {actionError}
        </p>
      )}
      {members.isPending ? (
        <p className="settings-muted">Loading members…</p>
      ) : members.error ? (
        <LoadError error={members.error} onRetry={() => members.refetch()} />
      ) : (
        <div className="settings-rows member-rows">
          {members.data.map((member) => {
            const isCurrent = member.user_id === userId;
            const mutable = canManage && member.role !== 'owner';
            return (
              <div className="settings-row member-row" key={member.user_id}>
                <span className="member-monogram" aria-hidden="true">
                  {monogram(member.display_name)}
                </span>
                <div className="member-copy">
                  <strong>
                    {member.display_name}
                    {isCurrent && <small className="inline-note">you</small>}
                  </strong>
                  <small>{member.email}</small>
                </div>
                {mutable ? (
                  <select
                    aria-label={`${member.display_name} role`}
                    value={member.role}
                    disabled={busyMember === member.user_id}
                    onChange={(event) =>
                      void changeRole(
                        member,
                        event.target.value as AssignableWorkspaceRole,
                      )
                    }
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="guest">Guest</option>
                  </select>
                ) : (
                  <span className="role-label">{titleCase(member.role)}</span>
                )}
                <div className="row-actions">
                  {workspace.role === 'owner' && member.role === 'admin' && (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={busyMember === member.user_id}
                      onClick={() => void transfer(member)}
                    >
                      Transfer ownership
                    </button>
                  )}
                  {mutable && !isCurrent && (
                    <button
                      className="icon-button"
                      type="button"
                      disabled={busyMember === member.user_id}
                      aria-label={`Remove ${member.display_name}`}
                      onClick={() => void remove(member)}
                    >
                      <UserMinus aria-hidden="true" size={15} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <RoleGuide />
    </SettingsArticle>
  );
}

function RoleGuide() {
  return (
    <section
      className="settings-section role-guide"
      aria-labelledby="role-guide-heading"
    >
      <div className="settings-section-heading">
        <div>
          <h2 id="role-guide-heading">Role guide</h2>
          <p>Project-level access is added in the next Kanleaf Core stage.</p>
        </div>
      </div>
      <dl>
        <div>
          <dt>Owner</dt>
          <dd>Full control, ownership transfer, and deletion.</dd>
        </div>
        <div>
          <dt>Admin</dt>
          <dd>Settings, members, invitations, and all content.</dd>
        </div>
        <div>
          <dt>Member</dt>
          <dd>Workspace Inbox and assigned project work.</dd>
        </div>
        <div>
          <dt>Guest</dt>
          <dd>Only projects explicitly shared with them.</dd>
        </div>
      </dl>
    </section>
  );
}
