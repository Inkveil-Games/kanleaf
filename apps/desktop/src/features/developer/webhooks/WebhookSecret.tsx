import { CopyButton } from '../../../components/ui/CopyButton';

export function WebhookSecret({ secret }: { secret: string }) {
  return (
    <section
      className="settings-section webhook-secret"
      aria-label="Signing secret"
    >
      <h2>Signing secret</h2>
      <p>Copy this secret now. For security, it won’t be shown again.</p>
      <code>{secret}</code>
      <CopyButton
        text={secret}
        label="Copy secret"
        successLabel="Secret copied"
        errorLabel="Select and copy the signing secret manually"
      />
    </section>
  );
}
