import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AppDialog } from '../../components/ui/AppDialog';
import { Button } from '../../components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuItem,
} from '../../components/ui/DropdownMenu';
import { Select } from '../../components/ui/Select';
import { Input } from '../../components/ui/Input';
import { SettingsArticle } from '../settings/SettingsArticle';
import {
  ActionMessage,
  LoadError,
  type ActionState,
} from '../settings/SettingsControls';
import {
  errorMessage,
  formatDateTime,
  monogram,
  titleCase,
} from '../settings/utils';
import {
  listWorkspaceInvitations,
  listWorkspaceMembers,
  removeWorkspaceMember,
  renewWorkspaceInvitation,
  revokeWorkspaceInvitation,
  transferWorkspaceOwnership,
  updateWorkspaceMember,
  type ApiContext,
} from './api';
import { InvitePeopleDialog } from './InvitePeopleDialog';
import { canManageWorkspace } from './permissions';
import { WorkspaceInvitationList } from './WorkspaceInvitationList';
import type {
  AssignableWorkspaceRole,
  IssuedWorkspaceInvitation,
  Workspace,
  WorkspaceInvitation,
  WorkspaceMember,
  WorkspaceRole,
} from './types';

interface WorkspaceMemberSettingsProps {
  context: ApiContext;
  workspace: Workspace;
  userId: string;
  onWorkspaceUpdated: () => Promise<void>;
}

const roleOptions = [
  { value: 'all', label: 'All roles' },
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
  { value: 'guest', label: 'Guest' },
];

export function WorkspaceMemberSettings({
  context,
  workspace,
  userId,
  onWorkspaceUpdated,
}: WorkspaceMemberSettingsProps) {
  const queryClient = useQueryClient();
  const canManage = canManageWorkspace(workspace);
  const members = useQuery({
    queryKey: ['workspace-members', workspace.id],
    queryFn: () => listWorkspaceMembers(context, workspace.id),
  });
  const invitations = useQuery({
    queryKey: ['workspace-invitations', workspace.id],
    queryFn: () => listWorkspaceInvitations(context, workspace.id),
    enabled: canManage,
  });
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<WorkspaceRole | 'all'>('all');
  const [actionState, setActionState] = useState<ActionState>({
    status: 'idle',
  });
  const [busyMember, setBusyMember] = useState<string | null>(null);
  const [busyInvitation, setBusyInvitation] = useState<string | null>(null);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [memberConfirmation, setMemberConfirmation] = useState<{
    type: 'remove' | 'transfer';
    member: WorkspaceMember;
  } | null>(null);
  const [issuedInvitation, setIssuedInvitation] =
    useState<IssuedWorkspaceInvitation | null>(null);

  const filteredMembers = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (members.data ?? []).filter(
      (member) =>
        (roleFilter === 'all' || member.role === roleFilter) &&
        (!needle ||
          member.display_name.toLocaleLowerCase().includes(needle) ||
          member.email.toLocaleLowerCase().includes(needle)),
    );
  }, [members.data, roleFilter, search]);

  const pendingInvitations = (invitations.data ?? []).filter(
    ({ status }) => status === 'pending',
  );
  const invitationHistory = (invitations.data ?? []).filter(
    ({ status }) => status !== 'pending',
  );

  async function refreshMembers() {
    await queryClient.invalidateQueries({
      queryKey: ['workspace-members', workspace.id],
    });
  }

  async function refreshInvitations() {
    await queryClient.invalidateQueries({
      queryKey: ['workspace-invitations', workspace.id],
    });
  }

  async function changeRole(
    member: WorkspaceMember,
    role: AssignableWorkspaceRole,
  ) {
    setBusyMember(member.user_id);
    setActionState({ status: 'saving' });
    try {
      await updateWorkspaceMember(context, workspace.id, member.user_id, role);
      await Promise.all([refreshMembers(), onWorkspaceUpdated()]);
      setActionState({ status: 'saved', message: 'Member role updated' });
    } catch (error) {
      setActionState({ status: 'error', message: errorMessage(error) });
    } finally {
      setBusyMember(null);
    }
  }

  async function remove(member: WorkspaceMember) {
    setBusyMember(member.user_id);
    setActionState({ status: 'saving' });
    try {
      await removeWorkspaceMember(context, workspace.id, member.user_id);
      await refreshMembers();
      setActionState({ status: 'saved', message: 'Member removed' });
    } catch (error) {
      setActionState({ status: 'error', message: errorMessage(error) });
      throw error;
    } finally {
      setBusyMember(null);
    }
  }

  async function transfer(member: WorkspaceMember) {
    setBusyMember(member.user_id);
    setActionState({ status: 'saving' });
    try {
      await transferWorkspaceOwnership(context, workspace.id, member.user_id);
      await Promise.all([refreshMembers(), onWorkspaceUpdated()]);
      setActionState({ status: 'saved', message: 'Ownership transferred' });
    } catch (error) {
      setActionState({ status: 'error', message: errorMessage(error) });
      throw error;
    } finally {
      setBusyMember(null);
    }
  }

  async function renew(invitation: WorkspaceInvitation) {
    setBusyInvitation(invitation.id);
    setActionState({ status: 'saving' });
    try {
      const issued = await renewWorkspaceInvitation(
        context,
        workspace.id,
        invitation.id,
      );
      await refreshInvitations();
      setIssuedInvitation(issued);
      setInviteDialogOpen(true);
      setActionState({ status: 'saved', message: 'Invitation renewed' });
    } catch (error) {
      setActionState({ status: 'error', message: errorMessage(error) });
    } finally {
      setBusyInvitation(null);
    }
  }

  async function revoke(invitation: WorkspaceInvitation) {
    setBusyInvitation(invitation.id);
    setActionState({ status: 'saving' });
    try {
      await revokeWorkspaceInvitation(context, workspace.id, invitation.id);
      await refreshInvitations();
      setActionState({ status: 'saved', message: 'Invitation revoked' });
    } catch (error) {
      setActionState({ status: 'error', message: errorMessage(error) });
    } finally {
      setBusyInvitation(null);
    }
  }

  function openInviteDialog() {
    setIssuedInvitation(null);
    setInviteDialogOpen(true);
  }

  return (
    <SettingsArticle
      eyebrow="Workspace"
      title="Members"
      description="Manage everyone who can enter this Workspace and invitations that have not been accepted yet."
      className="workspace-members-settings"
    >
      <div className="members-overview">
        <div>
          <strong>
            {members.isPending
              ? 'Loading members…'
              : `${members.data?.length ?? 0} ${(members.data?.length ?? 0) === 1 ? 'member' : 'members'}`}
          </strong>
          {canManage && (
            <span>
              {invitations.isPending
                ? 'Loading invitations…'
                : invitations.error
                  ? 'Invitations unavailable'
                  : `${pendingInvitations.length} ${pendingInvitations.length === 1 ? 'pending invitation' : 'pending invitations'}`}
            </span>
          )}
        </div>
        {canManage && (
          <Button variant="primary" size="sm" onClick={openInviteDialog}>
            <UserPlus aria-hidden="true" size={14} /> Invite people
          </Button>
        )}
      </div>

      <ActionMessage state={actionState} />

      <div className="member-filters" role="search">
        <label className="member-search">
          <Search aria-hidden="true" size={14} />
          <Input
            type="search"
            aria-label="Search members"
            placeholder="Search by name or email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <Select
          ariaLabel="Filter members by role"
          value={roleFilter}
          options={roleOptions}
          onValueChange={(value) =>
            setRoleFilter(value as WorkspaceRole | 'all')
          }
        />
      </div>

      {members.isPending ? (
        <p className="settings-muted">Loading members…</p>
      ) : members.error ? (
        <LoadError error={members.error} onRetry={() => members.refetch()} />
      ) : filteredMembers.length === 0 ? (
        <div className="settings-empty">
          <strong>No members match these filters</strong>
          <p>Try another name, email address, or role.</p>
        </div>
      ) : (
        <div className="settings-rows member-rows">
          {filteredMembers.map((member) => {
            const isCurrent = member.user_id === userId;
            const mutable = canManage && member.role !== 'owner';
            const canTransfer =
              workspace.role === 'owner' && member.role === 'admin';
            const canRemove = mutable && !isCurrent;
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
                <small className="member-joined">
                  Joined {formatDateTime(member.joined_at)}
                </small>
                {mutable ? (
                  <Select
                    ariaLabel={`${member.display_name} role`}
                    value={member.role}
                    disabled={busyMember === member.user_id}
                    options={roleOptions.slice(2)}
                    onValueChange={(value) =>
                      void changeRole(member, value as AssignableWorkspaceRole)
                    }
                  />
                ) : (
                  <span className="role-label">{titleCase(member.role)}</span>
                )}
                <div className="row-actions">
                  {(canTransfer || canRemove) && (
                    <DropdownMenu
                      label={`${member.display_name} actions`}
                      disabled={busyMember === member.user_id}
                    >
                      {canTransfer && (
                        <DropdownMenuItem
                          onClick={() =>
                            setMemberConfirmation({
                              type: 'transfer',
                              member,
                            })
                          }
                        >
                          <ShieldCheck aria-hidden="true" size={14} /> Transfer
                          ownership
                        </DropdownMenuItem>
                      )}
                      {canRemove && (
                        <DropdownMenuItem
                          className="danger-menu-item"
                          onClick={() =>
                            setMemberConfirmation({ type: 'remove', member })
                          }
                        >
                          <Trash2 aria-hidden="true" size={14} /> Remove member
                        </DropdownMenuItem>
                      )}
                    </DropdownMenu>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canManage && (
        <WorkspaceInvitationList
          query={invitations}
          pending={pendingInvitations}
          history={invitationHistory}
          busyInvitation={busyInvitation}
          onRenew={renew}
          onRevoke={revoke}
        />
      )}

      <RoleGuide />

      {inviteDialogOpen && (
        <InvitePeopleDialog
          context={context}
          workspaceId={workspace.id}
          initialInvitation={issuedInvitation ?? undefined}
          onInvitationCreated={refreshInvitations}
          onClose={() => {
            setInviteDialogOpen(false);
            setIssuedInvitation(null);
          }}
        />
      )}
      <AppDialog
        open={memberConfirmation !== null}
        onOpenChange={(open) => {
          if (!open) setMemberConfirmation(null);
        }}
        type="confirm"
        variant={memberConfirmation?.type === 'transfer' ? 'warning' : 'danger'}
        title={
          memberConfirmation?.type === 'transfer'
            ? `Transfer ownership to ${memberConfirmation.member.display_name}?`
            : `Remove ${memberConfirmation?.member.display_name ?? 'member'}?`
        }
        description={
          memberConfirmation?.type === 'transfer'
            ? `They will become the Owner of ${workspace.name}, and you will become an Admin.`
            : `They will lose access to ${workspace.name}.`
        }
        confirmLabel={
          memberConfirmation?.type === 'transfer'
            ? 'Transfer ownership'
            : 'Remove member'
        }
        loadingLabel={
          memberConfirmation?.type === 'transfer'
            ? 'Transferring…'
            : 'Removing…'
        }
        onConfirm={() => {
          if (!memberConfirmation) return;
          return memberConfirmation.type === 'transfer'
            ? transfer(memberConfirmation.member)
            : remove(memberConfirmation.member);
        }}
      />
    </SettingsArticle>
  );
}

function RoleGuide() {
  return (
    <details className="settings-section settings-disclosure role-guide">
      <summary>Role guide</summary>
      <p>Project roles refine access for each shared Project.</p>
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
          <dd>Workspace Inbox and assigned Project work.</dd>
        </div>
        <div>
          <dt>Guest</dt>
          <dd>Only Projects explicitly shared with them.</dd>
        </div>
      </dl>
    </details>
  );
}
