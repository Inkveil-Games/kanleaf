import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { AppDialog } from '../../components/ui/AppDialog';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PasswordField } from '../../components/ui/PasswordField';
import { SettingsArticle } from '../settings/SettingsArticle';

export function AccountDangerSettings({
  email,
  onDeleteAccount,
}: {
  email: string;
  onDeleteAccount: (password: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  return (
    <SettingsArticle
      eyebrow="Account"
      title="Danger zone"
      description="Permanent actions for this account."
    >
      <section className="danger-section">
        <div>
          <h2>Delete account</h2>
          <p>
            Permanently deletes your account, signs you out everywhere, and
            removes your memberships and personal account data. Shared
            Workspaces remain.
          </p>
          <p>
            Delete or transfer ownership of every Workspace you own before
            deleting your account.
          </p>
        </div>
        <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
          <Trash2 aria-hidden="true" size={14} /> Delete account
        </Button>
      </section>
      <AppDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setPassword('');
        }}
        type="typed-confirm"
        variant="danger"
        title="Delete account?"
        description="This permanently deletes your account and signs you out everywhere. This cannot be undone."
        confirmationText={email}
        confirmLabel="Delete account"
        loadingLabel="Deleting…"
        confirmDisabled={!password}
        onConfirm={() => onDeleteAccount(password)}
      >
        <FormField label="Current password" required>
          <PasswordField
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </FormField>
      </AppDialog>
    </SettingsArticle>
  );
}
