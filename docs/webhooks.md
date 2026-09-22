# Workspace webhooks

Owners and Admins manage Workspace webhooks in Developer Console → Webhooks.
Current membership is checked on every internal application request; Host
status alone grants no access. Webhooks belong to the Workspace, regardless of
who created them. Members and Guests cannot manage them.

## Instance configuration

Set `KANLEAF_WEBHOOK_SIGNING_KEY` to a securely generated 32-byte base64 key:

```sh
openssl rand -base64 32
```

Put the result in your protected instance environment file. A blank key disables
webhook management/delivery; malformed non-empty keys fail startup. Keep this
key with protected backups and preserve it across container/server restarts.
Existing webhooks prevent startup with a missing or different key. Changing the
instance key is not a supported rotation workflow; use each webhook's
**Regenerate secret** action instead.

Each webhook has random 32-byte derivation material. Its secret is
`klf_whsec_` followed by base64url of a domain-separated HMAC-SHA256 over the
Workspace UUID, webhook UUID, and that material, keyed by the instance key.
PostgreSQL stores only the material and a key fingerprint. It does not store
the raw signing secret or instance key. Raw secrets are returned only at
creation/regeneration, with `Cache-Control: no-store`. The browser displays
them in component memory; normal GET/list responses cannot recover them.

Copy the secret at creation/regeneration and keep it in your receiver's secret
manager. Regeneration replaces the material and secret. An already-running
request may finish with the previous secret; future attempts use the new one.

## Event contract

Every new request is JSON with `version: 2`, a globally unique event `id`, a stable
`type`, ISO-8601 `occurred_at`, Workspace `{id, identifier}`, and actor `{id}`
when applicable. Project events also have Project `{id, identifier}`.
Deliveries created before this contract change keep their stored version-1 body
unchanged, including across retries; Kanleaf never rewrites durable historical
delivery payloads.

| Event             | Data                                        | Trigger                                                                     |
| ----------------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| `task.created`    | `task`, empty `changed_fields`              | A Project Task is created                                                   |
| `task.updated`    | `task`, `changed_fields`                    | Direct structured edit, bulk edit, archive, or custom-property value change |
| `task.deleted`    | Pre-deletion `task`, empty `changed_fields` | Confirmed permanent Task deletion                                           |
| `comment.created` | `comment`                                   | A Project Task comment/reply is created                                     |
| `comment.updated` | `comment`                                   | Comment body or mentions change                                             |
| `comment.deleted` | `comment`, without `body`                   | Comment is tombstoned                                                       |
| `webhook.test`    | `message: "Kanleaf webhook test"`           | Manual test; no Project                                                     |

Task snapshots contain `id`, `task_number`, the ordinary `#<number>`
`reference`, `title`, `state_id`, `priority`, `archived_at`, and `updated_at`.
Comment snapshots contain `id`, `task_id`, `parent_id`,
`updated_at`, and `body` except for deletion. Other private user/profile fields,
Markdown task bodies, vault paths, and authentication material are excluded.

One logical edit produces at most one `task.updated` event, with a list of
changed fields. Inbox Tasks/comments are excluded. Moving to another Project
emits the snapshot in the target Project; moving to Inbox emits no Project
event. Markdown-only saves, Task ordering/relations, configuration fan-out,
aggregate Project/Workspace deletion, import, and projection workers do not
emit these V2 events. Task archive is an update, not permanent deletion. There
is no special completion event.

The serializer-owned [example bodies](../apps/server/tests/fixtures/webhook-payloads.json)
are the same contract used by real requests and Developer Console's live
**Payload preview**. The fixed example UUIDs, dates, and entity text identify
representative data. Generate the fixtures with
`cargo run --locked -p kanleaf-server --example webhook_payloads`; contract
tests compare them to the actual serializer. The preview uses only selected
events, optionally the selected Project identity, and never signs or sends a
request.

## Scope and delivery

Subscribe to one or more of the six Project event types. **All projects**
includes matching Project events throughout the Workspace. **Selected projects**
requires at least one Project from that Workspace. Deleted Project selections
are removed; an empty selected scope receives no events and must be edited
before re-enabling. Project archive retains its selection.

Business mutations insert a durable event and consumer outbox row in the same
PostgreSQL transaction. Rolled-back mutations produce no event. Dispatch
matches current enabled subscriptions/scope and creates a delivery per webhook.
Webhooks do not receive events from before their creation or most recent
enablement, and consumed events are not backfilled after subscription edits.
Realtime notifications/comments continue using their independent live channel.

Delivery is asynchronous and **at least once**. A successful mutation never
waits for your endpoint. HTTP 2xx succeeds; other statuses and network/timeouts
fail. There are at most six attempts, with backoff of 30 seconds, 2 minutes,
10 minutes, 1 hour, and 6 hours. The final failure remains visible in Recent
deliveries. Pending work survives process restarts. Four bounded delivery
workers per server use PostgreSQL row locks and `SKIP LOCKED`; multiple server
processes cannot own the same attempt concurrently. A transaction advisory
lock limits each webhook to one running attempt across processes, allowing
other endpoints to progress during a slow webhook backlog. Receiver
acknowledgement followed by a server crash may still cause a repeat.

Use `X-Kanleaf-Delivery` for deduplication, and the body event `id` when combining
deliveries across webhooks. Delivery ID and exact JSON body stay unchanged on
retries. Ordering between different events is not guaranteed. Disabling cancels
queued normal deliveries; re-enabling does not resume them. An in-flight attempt
may finish. Deleting a webhook removes its deliveries. Workspace deletion
cascades webhook/event/outbox data. Terminal event/delivery history is retained
for 30 days; pending work is not removed by retention.

The existing vault/database cross-store boundary remains: structured metadata
and its event commit together, while Markdown projection can finish afterward.
Existing Task move/trash crash windows are not made atomic by this outbox.
Markdown-only changes remain outside the V2 event catalog.

**Send test webhook** queues a durable `webhook.test` delivery and returns HTTP
202 with its ID and pending status. The page polls the scoped delivery result
and refreshes Recent deliveries to display success/failure, HTTP status,
elapsed time, and safe error information. Tests
use the same transport/security/signing path, work while disabled, and make
one attempt to provide immediate diagnostic feedback. Receiver bodies and
headers are never stored or displayed.

## Request signature

Headers:

```text
Content-Type: application/json
X-Kanleaf-Event: task.updated
X-Kanleaf-Delivery: <stable delivery UUID>
X-Kanleaf-Timestamp: <Unix seconds for this attempt>
X-Kanleaf-Signature: v1=<lowercase hex HMAC-SHA256>
```

Sign the literal UTF-8 secret including `klf_whsec_`, not its decoded suffix:

```text
HMAC-SHA256(secret, timestamp + "." + exact_raw_request_body)
```

Verify before parsing JSON. Use a constant-time comparison and a timestamp
tolerance (for example five minutes) to resist replay. Retry timestamps and
signatures are recalculated for the unchanged body/delivery ID. Deduplication
must remain separate from timestamp verification.

Minimal Node.js receiver verification (no framework dependency):

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyWebhook(headers, rawBody, secret) {
  const timestamp = headers['x-kanleaf-timestamp'];
  const signature = headers['x-kanleaf-signature'];
  if (
    !/^\d+$/.test(timestamp ?? '') ||
    !/^v1=[0-9a-f]{64}$/.test(signature ?? '')
  )
    return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac('sha256', secret)
    .update(timestamp + '.')
    .update(rawBody) // Buffer, collected with an application-specific size limit
    .digest();
  const provided = Buffer.from(signature.slice(3), 'hex');
  return timingSafeEqual(expected, provided);
}
```

After verification, deduplicate/store the delivery and process the parsed event
before acknowledging with a 2xx. Never verify against re-serialized JSON.

## Destination security

HTTPS is the default. `KANLEAF_WEBHOOK_ALLOW_HTTP=false` must be explicitly
changed to `true` to permit HTTP. HTTP transmits payloads without encryption;
use HTTPS wherever possible.

`KANLEAF_WEBHOOK_ALLOW_PRIVATE_NETWORKS=false` rejects resolved non-public
IPv4/IPv6 destinations including loopback, private, link-local, unspecified,
multicast, shared, documentation/reserved, and cloud metadata local ranges.
Every DNS result must pass policy; destinations are checked at configuration
time and again before every attempt. Approved addresses are pinned for the
connection while hostname/TLS verification is retained, preventing a second DNS
lookup from redirecting the connection. Redirects, system proxies, and automatic
transport retries are disabled. A redirect is an ordinary failed HTTP attempt.

Self-host administrators may intentionally set
`KANLEAF_WEBHOOK_ALLOW_PRIVATE_NETWORKS=true` for LAN/Docker receivers. That is
an explicit trust decision enabling local/private destinations. Unspecified,
multicast, broadcast, credentials in URLs, fragments, unsupported schemes,
invalid hosts, and port zero remain rejected. HTTP permission remains separate.
Send test obeys the same policies.

DNS has a three-second limit, connect has three seconds, and the complete attempt
including resolution has a ten-second deadline. Response bodies are dropped;
only HTTP status, duration, attempts, and fixed safe error summaries persist.
Secrets, receiver content, and credentials are not logged.

## Internal application endpoints

All routes use ordinary Kanleaf session authentication and current Workspace
Owner/Admin authorization:

```text
GET/POST   /api/workspaces/:workspaceId/webhooks
GET/PATCH/DELETE /api/workspaces/:workspaceId/webhooks/:webhookId
PATCH      /api/workspaces/:workspaceId/webhooks/:webhookId/enabled
POST       /api/workspaces/:workspaceId/webhooks/:webhookId/secret
POST       /api/workspaces/:workspaceId/webhooks/:webhookId/test
GET        /api/workspaces/:workspaceId/webhooks/:webhookId/deliveries
GET        /api/workspaces/:workspaceId/webhooks/:webhookId/deliveries/:deliveryId
GET        /api/workspaces/:workspaceId/webhook-catalog?project_id=...
```

Create/update validates names, endpoint policy, known distinct events, and
Workspace Project ownership. The catalog returns serializer-generated examples
and instance HTTP policy; it does not disclose other Workspace resources.
