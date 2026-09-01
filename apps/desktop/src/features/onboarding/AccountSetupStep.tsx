import { useId, useState, type FormEvent } from 'react';
import { Select } from '../../components/ui/Select';
import { ApiError } from '../../lib/api/client';
import type { User } from '../../lib/api/types';
import { applyTheme } from '../account/theme';
import { errorMessage } from '../settings/utils';
import type { ApiContext } from '../workspace/api';
import { updateAccountSetup } from './api';

interface AccountSetupStepProps {
  context: ApiContext;
  user: User;
  onCompleted: (user: User) => void | Promise<void>;
  onSignOut: () => void;
}

export function AccountSetupStep({
  context,
  user,
  onCompleted,
  onSignOut,
}: AccountSetupStepProps) {
  const [displayName, setDisplayName] = useState(user.display_name);
  const [theme, setTheme] = useState(user.theme);
  const [timezone, setTimezone] = useState(user.timezone);
  const [weekStart, setWeekStart] = useState(user.week_start);
  const [dateFormat, setDateFormat] = useState(user.date_format);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [timezoneError, setTimezoneError] = useState<string | null>(null);
  const displayNameInputId = useId();
  const displayNameErrorId = useId();
  const timezoneInputId = useId();
  const timezoneErrorId = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const includePreferences = submitter?.value !== 'defaults';
    const normalizedDisplayName = displayName.trim();
    const normalizedTimezone = timezone.trim();
    const nextDisplayNameError = normalizedDisplayName
      ? null
      : 'Enter a display name';
    const nextTimezoneError =
      includePreferences && !normalizedTimezone
        ? 'Enter an IANA timezone name'
        : null;
    setDisplayNameError(nextDisplayNameError);
    setTimezoneError(nextTimezoneError);
    setError(null);
    if (nextDisplayNameError || nextTimezoneError) return;

    setSubmitting(true);
    try {
      const updated = await updateAccountSetup(context, {
        display_name: normalizedDisplayName,
        ...(includePreferences
          ? {
              theme,
              timezone: normalizedTimezone,
              week_start: weekStart,
              date_format: dateFormat,
            }
          : {}),
      });
      applyTheme(updated.theme);
      await onCompleted(updated);
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.code === 'validation_error' &&
        caught.message === 'Timezone must be a valid IANA name'
      ) {
        setTimezoneError(caught.message);
      } else {
        setError(errorMessage(caught));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="setup-step">
      <header className="setup-step-heading">
        <p className="eyebrow">Your account</p>
        <h1>Make Kanleaf feel like yours</h1>
        <p>Choose how your name, dates, and working week appear.</p>
      </header>
      <form className="settings-form" onSubmit={(event) => void submit(event)}>
        <div className="settings-field">
          <label htmlFor={displayNameInputId}>Display name</label>
          <input
            id={displayNameInputId}
            required
            maxLength={120}
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setDisplayNameError(null);
              setError(null);
            }}
            autoFocus
            disabled={submitting}
            aria-invalid={displayNameError ? true : undefined}
            aria-describedby={displayNameError ? displayNameErrorId : undefined}
          />
          {displayNameError ? (
            <small
              className="settings-error"
              id={displayNameErrorId}
              role="alert"
            >
              {displayNameError}
            </small>
          ) : null}
        </div>
        <div className="setup-preference-grid">
          <label className="settings-field">
            <span>Theme</span>
            <Select
              ariaLabel="Theme"
              value={theme}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
              onValueChange={(value) => setTheme(value as User['theme'])}
              disabled={submitting}
            />
          </label>
          <div className="settings-field">
            <label htmlFor={timezoneInputId}>Timezone</label>
            <input
              id={timezoneInputId}
              maxLength={64}
              value={timezone}
              onChange={(event) => {
                setTimezone(event.target.value);
                setTimezoneError(null);
                setError(null);
              }}
              placeholder="Asia/Ho_Chi_Minh"
              disabled={submitting}
              aria-invalid={timezoneError ? true : undefined}
              aria-describedby={timezoneError ? timezoneErrorId : undefined}
            />
            {timezoneError ? (
              <small
                className="settings-error"
                id={timezoneErrorId}
                role="alert"
              >
                {timezoneError}
              </small>
            ) : null}
          </div>
          <label className="settings-field">
            <span>Week starts on</span>
            <Select
              ariaLabel="Week starts on"
              value={weekStart}
              options={[
                { value: 'monday', label: 'Monday' },
                { value: 'sunday', label: 'Sunday' },
              ]}
              onValueChange={(value) =>
                setWeekStart(value as User['week_start'])
              }
              disabled={submitting}
            />
          </label>
          <label className="settings-field">
            <span>Date format</span>
            <Select
              ariaLabel="Date format"
              value={dateFormat}
              options={[
                { value: 'locale', label: 'Locale default' },
                { value: 'yyyy_mm_dd', label: 'YYYY-MM-DD' },
                { value: 'dd_mm_yyyy', label: 'DD-MM-YYYY' },
                { value: 'mm_dd_yyyy', label: 'MM-DD-YYYY' },
              ]}
              onValueChange={(value) =>
                setDateFormat(value as User['date_format'])
              }
              disabled={submitting}
            />
          </label>
        </div>
        {error ? (
          <p className="settings-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="setup-actions">
          <button
            className="text-button"
            type="button"
            disabled={submitting}
            onClick={onSignOut}
          >
            Sign out
          </button>
          <div>
            <button
              className="secondary-button"
              type="submit"
              value="defaults"
              disabled={submitting}
            >
              Use default preferences
            </button>
            <button
              className="primary-button compact-button"
              type="submit"
              value="preferences"
              disabled={submitting}
            >
              {submitting ? 'Saving…' : 'Continue'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
