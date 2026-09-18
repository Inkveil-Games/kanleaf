import { Webhook } from 'lucide-react';
import { DeveloperPage } from './DeveloperPage';

export function DeveloperWebhooks() {
  return (
    <DeveloperPage
      title="Webhooks"
      description="Send Workspace events to external services."
    >
      <section
        className="developer-empty"
        aria-labelledby="developer-webhooks-empty"
      >
        <Webhook aria-hidden="true" size={22} />
        <h2 id="developer-webhooks-empty">Webhooks are coming to Kanleaf</h2>
        <p>
          Webhooks will allow external services to receive Workspace events.
        </p>
        <p>Webhook endpoints and subscriptions will be managed here.</p>
      </section>
    </DeveloperPage>
  );
}
