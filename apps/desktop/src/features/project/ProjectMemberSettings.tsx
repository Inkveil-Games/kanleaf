import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { UserMinus } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { AppDialog } from '../../components/ui/AppDialog';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { IconButton } from '../../components/ui/IconButton';
import { Select } from '../../components/ui/Select';
import { SettingsArticle } from '../settings/SettingsArticle';
import {
  ActionMessage,
  LoadError,
  type ActionState,
} from '../settings/SettingsControls';
import { errorMessage, monogram, titleCase } from '../settings/utils';
import {
  addProjectMember,
  removeProjectMember,
  updateProjectMember,
  type ApiContext,
} from '../workspace/api';
import type {
  Project,
  ProjectMember,
  ProjectRole,
  Workspace,
  WorkspaceMember,
} from '../workspace/types';

interface ProjectMemberSettingsProps {
  context: ApiContext;
  workspace: Workspace;
  project: Project;
  userId: string;
  membersQuery: UseQueryResult<ProjectMember[]>;
  workspaceMembersQuery: UseQueryResult<WorkspaceMember[]>;
}

export function ProjectMemberSettings({
  context,
  workspace,
  project,
  userId,
  membersQuery,
  workspaceMembersQuery,
}: ProjectMemberSettingsProps) {
  const queryClient = useQueryClient();
  const [candidateId, setCandidateId] = useState('');
  const [role, setRole] = useState<ProjectRole>('contributor');
  const [busyMember, setBusyMember] = useState<string | null>(null);
  const [removingMember, setRemovingMember] = useState<ProjectMember | null>(
    null,
  );
  const [state, setState] = useState<ActionState>({ status: 'idle' });
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const workspaceMembers = useMemo(
    () => workspaceMembersQuery.data ?? [],
    [workspaceMembersQuery.data],
  );
  const candidates = useMemo(
    () =>
      workspaceMembers.filter(
        (member) =>
          !['owner', 'admin'].includes(member.role) &&
          !members.some(({ user_id }) => user_id === member.user_id),
      ),
    [members, workspaceMembers],
  );
  const selectedCandidateId = candidates.some(
    ({ user_id }) => user_id === candidateId,
  )
    ? candidateId
    : (candidates[0]?.user_id ?? '');
  const selectedCandidate = candidates.find(
    ({ user_id }) => user_id === selectedCandidateId,
  );
  const selectedRole =
    selectedCandidate?.role === 'guest' && role === 'admin'
      ? 'contributor'
      : role;

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: ['project-members', workspace.id, project.id],
    });
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!selectedCandidateId) return;
    setState({ status: 'saving' });
    try {
      await addProjectMember(
        context,
        workspace.id,
        project.id,
        selectedCandidateId,
        selectedRole,
      );
      await refresh();
      setState({ status: 'saved', message: 'Project member added.' });
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  async function changeRole(member: ProjectMember, nextRole: ProjectRole) {
    setBusyMember(member.user_id);
    setState({ status: 'idle' });
    try {
      await updateProjectMember(
        context,
        workspace.id,
        project.id,
        member.user_id,
        nextRole,
      );
      await refresh();
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    } finally {
      setBusyMember(null);
    }
  }

  async function remove(member: ProjectMember) {
    setBusyMember(member.user_id);
    setState({ status: 'idle' });
    try {
      await removeProjectMember(
        context,
        workspace.id,
        project.id,
        member.user_id,
      );
      await refresh();
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
      throw error;
    } finally {
      setBusyMember(null);
    }
  }

  if (membersQuery.error) {
    return (
      <SettingsArticle
        eyebrow="Project"
        title="Members"
        description="Project-specific access and roles."
      >
        <LoadError
          error={membersQuery.error}
          onRetry={() => membersQuery.refetch()}
        />
      </SettingsArticle>
    );
  }

  return (
    <SettingsArticle
      eyebrow="Project"
      title="Members"
      description="Grant Project access to existing Workspace members and Guests."
    >
      <form
        className="project-member-form"
        onSubmit={(event) => void add(event)}
      >
        <FormField label="Workspace member">
          <Select
            ariaLabel="Workspace member"
            value={selectedCandidateId}
            disabled={
              workspaceMembersQuery.isPending || candidates.length === 0
            }
            options={
              candidates.length === 0
                ? [{ value: '', label: 'No members available' }]
                : candidates.map((member) => ({
                    value: member.user_id,
                    label: `${member.display_name} · ${titleCase(member.role)}`,
                  }))
            }
            onValueChange={(nextId) => {
              setCandidateId(nextId);
              const nextCandidate = candidates.find(
                ({ user_id }) => user_id === nextId,
              );
              if (nextCandidate?.role === 'guest' && role === 'admin') {
                setRole('contributor');
              }
            }}
          />
        </FormField>
        <FormField label="Project role">
          <Select
            ariaLabel="New Project role"
            value={selectedRole}
            options={[
              ...(selectedCandidate?.role !== 'guest'
                ? [{ value: 'admin', label: 'Admin' }]
                : []),
              { value: 'contributor', label: 'Contributor' },
              { value: 'commenter', label: 'Commenter' },
              { value: 'viewer', label: 'Viewer' },
            ]}
            onValueChange={(value) => setRole(value as ProjectRole)}
          />
        </FormField>
        <Button
          variant="primary"
          size="sm"
          type="submit"
          disabled={!selectedCandidateId || state.status === 'saving'}
        >
          Add member
        </Button>
      </form>
      <ActionMessage state={state} />

      {membersQuery.isPending ? (
        <p className="settings-muted">Loading Project members…</p>
      ) : (
        <div className="settings-rows member-rows">
          {members.map((member) => {
            const workspaceMember = workspaceMembers.find(
              ({ user_id }) => user_id === member.user_id,
            );
            const canBeAdmin = workspaceMember?.role !== 'guest';
            return (
              <div className="settings-row member-row" key={member.user_id}>
                <span className="member-monogram" aria-hidden="true">
                  {monogram(member.display_name)}
                </span>
                <div className="member-copy">
                  <strong>
                    {member.display_name}
                    {member.user_id === userId && (
                      <small className="inline-note">you</small>
                    )}
                  </strong>
                  <small>{member.email}</small>
                </div>
                {member.implicit ? (
                  <span className="role-label">Admin · Workspace</span>
                ) : (
                  <Select
                    ariaLabel={`${member.display_name} Project role`}
                    value={member.role}
                    disabled={busyMember === member.user_id}
                    options={[
                      ...(canBeAdmin
                        ? [{ value: 'admin', label: 'Admin' }]
                        : []),
                      { value: 'contributor', label: 'Contributor' },
                      { value: 'commenter', label: 'Commenter' },
                      { value: 'viewer', label: 'Viewer' },
                    ]}
                    onValueChange={(value) =>
                      void changeRole(member, value as ProjectRole)
                    }
                  />
                )}
                <div className="row-actions">
                  {!member.implicit && (
                    <IconButton
                      disabled={busyMember === member.user_id}
                      aria-label={`Remove ${member.display_name}`}
                      onClick={() => setRemovingMember(member)}
                    >
                      <UserMinus aria-hidden="true" size={15} />
                    </IconButton>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <section
        className="settings-section role-guide"
        aria-labelledby="project-role-guide"
      >
        <div className="settings-section-heading">
          <div>
            <h2 id="project-role-guide">Role guide</h2>
            <p>Workspace Owners and Admins are implicit Project Admins.</p>
          </div>
        </div>
        <dl>
          <div>
            <dt>Admin</dt>
            <dd>Settings, members, and all Project content.</dd>
          </div>
          <div>
            <dt>Contributor</dt>
            <dd>Create and edit Project work.</dd>
          </div>
          <div>
            <dt>Commenter</dt>
            <dd>Read access; comments arrive in a later stage.</dd>
          </div>
          <div>
            <dt>Viewer</dt>
            <dd>Read-only Project access.</dd>
          </div>
        </dl>
      </section>
      <AppDialog
        open={removingMember !== null}
        onOpenChange={(open) => {
          if (!open) setRemovingMember(null);
        }}
        type="confirm"
        variant="danger"
        title={`Remove ${removingMember?.display_name ?? 'member'}?`}
        description={`They will lose access to ${project.name}.`}
        confirmLabel="Remove member"
        loadingLabel="Removing…"
        onConfirm={() => {
          if (!removingMember) return;
          return remove(removingMember);
        }}
      />
    </SettingsArticle>
  );
}
