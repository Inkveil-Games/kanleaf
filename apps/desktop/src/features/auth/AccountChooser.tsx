import { LogIn, UserPlus } from 'lucide-react';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { InlineAlert } from '../../components/ui/InlineAlert';
import { Wordmark } from '../../components/ui/Wordmark';
import type { AccountSession } from './accountSessionStore';

interface AccountChooserProps {
  accounts: AccountSession[];
  transitioning: boolean;
  error: string | null;
  onSelect: (userId: string) => void;
  onUseAnother: () => void;
}

export function AccountChooser({
  accounts,
  transitioning,
  error,
  onSelect,
  onUseAnother,
}: AccountChooserProps) {
  return (
    <main className="account-chooser">
      <section aria-labelledby="account-chooser-title">
        <Wordmark quiet />
        <div className="form-heading">
          <h1 id="account-chooser-title">Choose an account</h1>
          <p>Continue with a session saved for this Kanleaf server.</p>
        </div>
        <div className="account-chooser-list">
          {accounts.map((account) => (
            <button
              key={account.user_id}
              type="button"
              disabled={transitioning}
              onClick={() => onSelect(account.user_id)}
            >
              <Avatar
                name={account.display_name || account.email}
                fallback="U"
                aria-hidden="true"
              />
              <span>
                <strong>{account.display_name}</strong>
                <small>{account.email}</small>
              </span>
              <LogIn aria-hidden="true" size={15} />
            </button>
          ))}
        </div>
        {error && <InlineAlert variant="danger">{error}</InlineAlert>}
        <Button
          variant="secondary"
          className="account-chooser-another"
          type="button"
          disabled={transitioning}
          onClick={onUseAnother}
        >
          <UserPlus aria-hidden="true" size={15} /> Use another account
        </Button>
      </section>
    </main>
  );
}
