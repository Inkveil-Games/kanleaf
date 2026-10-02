import { apiRequest } from '../../lib/api/client';

export interface DocumentContext {
  serverUrl: string;
  token: string;
  workspaceId: string;
  target: MarkdownTarget;
}

export interface MarkdownTarget {
  kind: 'task' | 'page';
  id: string;
}

export interface MarkdownContent {
  content: string;
  revision: string;
  projection?: {
    status: 'saved' | 'pending' | 'error';
    metadata_version: number;
    projected_metadata_version: number;
    message: string | null;
  };
}

export interface UploadedMarkdownAsset {
  reference: string;
  original_name: string;
  mime_type: string;
  size: number;
}

export function readMarkdownDocument(context: DocumentContext) {
  return apiRequest<MarkdownContent>(context.serverUrl, documentPath(context), {
    token: context.token,
  });
}

export function writeMarkdownDocument(
  context: DocumentContext,
  content: string,
  baseRevision: string,
) {
  return apiRequest<MarkdownContent>(context.serverUrl, documentPath(context), {
    method: 'PUT',
    token: context.token,
    body: JSON.stringify({ content, base_revision: baseRevision }),
  });
}

export function uploadMarkdownImage(context: DocumentContext, file: File) {
  const body = new FormData();
  body.append('file', file);
  return apiRequest<UploadedMarkdownAsset>(
    context.serverUrl,
    `${assetPath(context)}?${assetTargetQuery(context)}`,
    { method: 'POST', token: context.token, body },
  );
}

export async function readMarkdownAsset(
  context: DocumentContext,
  reference: string,
) {
  const match =
    /^kanleaf-asset:\/\/images\/([0-9a-f-]+\.(?:png|jpg|gif|webp))$/.exec(
      reference,
    );
  if (!match?.[1]) throw new Error('Asset reference is invalid');
  const response = await fetch(
    `${context.serverUrl}${assetPath(context)}/${encodeURIComponent(match[1])}?${assetTargetQuery(context)}`,
    { headers: { authorization: `Bearer ${context.token}` } },
  );
  if (!response.ok) throw new Error('Asset could not be loaded');
  return URL.createObjectURL(await response.blob());
}

function documentPath(context: DocumentContext) {
  return context.target.kind === 'task'
    ? `/api/workspaces/${context.workspaceId}/tasks/${context.target.id}/document`
    : `/api/workspaces/${context.workspaceId}/documents/${context.target.id}/content`;
}

function assetPath(context: DocumentContext) {
  return `/api/workspaces/${context.workspaceId}/assets/images`;
}

function assetTargetQuery(context: DocumentContext) {
  return new URLSearchParams({
    target_kind: context.target.kind === 'task' ? 'task' : 'document',
    target_id: context.target.id,
  }).toString();
}
