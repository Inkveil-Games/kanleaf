import { LogIn, UserPlus } from 'lucide-react';
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
              <span className="member-monogram" aria-hidden="true">
                {initial(account.display_name || account.email)}
              </span>
              <span>
                <strong>{account.display_name}</strong>
                <small>{account.email}</small>
              </span>
              <LogIn aria-hidden="true" size={15} />
            </button>
          ))}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="account-chooser-another"
          type="button"
          disabled={transitioning}
          onClick={onUseAnother}
        >
          <UserPlus aria-hidden="true" size={15} /> Use another account
        </button>
      </section>
    </main>
  );
}

function initial(value: string) {
  return value.trim().charAt(0).toUpperCase() || 'U';
}
