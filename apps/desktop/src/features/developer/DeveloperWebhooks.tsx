import type { MouseEventHandler } from 'react';
import type { ApiContext } from '../workspace/api';
import type { Workspace } from '../workspace/types';
import type { DeveloperSection } from './developerLocation';
import { WebhookCreate } from './webhooks/WebhookCreate';
import { WebhookDetail } from './webhooks/WebhookDetail';
import { WebhookList } from './webhooks/WebhookList';
import './webhooks/webhooks.css';

export function DeveloperWebhooks(props: {
  context: ApiContext;
  workspace: Workspace;
  section: DeveloperSection;
  webhookId?: string;
  onNavigate: MouseEventHandler<HTMLAnchorElement>;
  navigateTo: (path: string) => void;
}) {
  if (props.section === 'webhook-new') return <WebhookCreate {...props} />;
  if (props.section === 'webhook-detail' && props.webhookId)
    return <WebhookDetail {...props} id={props.webhookId} />;
  return <WebhookList {...props} />;
}
