import type { Project } from '../workspace/types';
import type { WorkspaceDocument } from './types';

export interface TreeEntry {
  document: WorkspaceDocument;
  depth: number;
  hasChildren: boolean;
}

export interface DocumentSection {
  id: string;
  label: string;
  entries: TreeEntry[];
}

export function buildSections(
  documents: WorkspaceDocument[],
  projects: Project[],
  projectId: string | null,
): DocumentSection[] {
  if (projectId) {
    const project = projects.find(({ id }) => id === projectId);
    return [
      {
        id: projectId,
        label: project?.name ?? 'Project',
        entries: flattenTree(
          documents.filter((document) => document.project_id === projectId),
        ),
      },
    ].filter((section) => section.entries.length > 0);
  }

  const sections: DocumentSection[] = [];
  const workspaceEntries = flattenTree(
    documents.filter((document) => document.project_id === null),
  );
  if (workspaceEntries.length > 0) {
    sections.push({
      id: 'workspace',
      label: 'Workspace',
      entries: workspaceEntries,
    });
  }
  for (const project of projects) {
    const projectEntries = flattenTree(
      documents.filter((document) => document.project_id === project.id),
    );
    if (projectEntries.length > 0) {
      sections.push({
        id: project.id,
        label: project.name,
        entries: projectEntries,
      });
    }
  }
  return sections;
}

export function visibleSections(
  sections: DocumentSection[],
  collapsedIds: ReadonlySet<string>,
): DocumentSection[] {
  return sections.map((section) => {
    let hiddenBelowDepth: number | null = null;
    const entries = section.entries.filter((entry) => {
      if (hiddenBelowDepth !== null && entry.depth > hiddenBelowDepth) {
        return false;
      }
      hiddenBelowDepth = null;
      if (entry.hasChildren && collapsedIds.has(entry.document.id)) {
        hiddenBelowDepth = entry.depth;
      }
      return true;
    });
    return { ...section, entries };
  });
}

export function descendantIds(
  documents: WorkspaceDocument[],
  documentId: string,
) {
  const descendants = new Set<string>();
  const pending = [documentId];
  while (pending.length > 0) {
    const parentId = pending.pop();
    for (const document of documents) {
      if (document.parent_id === parentId && !descendants.has(document.id)) {
        descendants.add(document.id);
        pending.push(document.id);
      }
    }
  }
  return descendants;
}

export function canMove(
  document: WorkspaceDocument,
  documents: WorkspaceDocument[],
  offset: -1 | 1,
) {
  const siblings = documents
    .filter(
      (candidate) =>
        candidate.project_id === document.project_id &&
        candidate.parent_id === document.parent_id,
    )
    .sort(compareDocuments);
  const index = siblings.findIndex(({ id }) => id === document.id);
  return index >= 0 && index + offset >= 0 && index + offset < siblings.length;
}

export function compareDocuments(
  left: WorkspaceDocument,
  right: WorkspaceDocument,
) {
  return left.position - right.position || left.id.localeCompare(right.id);
}

export function isProjectEditor(project: Project | null | undefined) {
  return (
    project?.effective_role === 'admin' ||
    project?.effective_role === 'contributor'
  );
}

function flattenTree(documents: WorkspaceDocument[]) {
  const children = new Map<string | null, WorkspaceDocument[]>();
  for (const document of documents) {
    const siblings = children.get(document.parent_id) ?? [];
    siblings.push(document);
    children.set(document.parent_id, siblings);
  }
  for (const siblings of children.values()) siblings.sort(compareDocuments);

  const entries: TreeEntry[] = [];
  function visit(document: WorkspaceDocument, depth: number) {
    const nested = children.get(document.id) ?? [];
    entries.push({ document, depth, hasChildren: nested.length > 0 });
    for (const child of nested) visit(child, depth + 1);
  }
  for (const root of children.get(null) ?? []) visit(root, 0);
  return entries;
}
