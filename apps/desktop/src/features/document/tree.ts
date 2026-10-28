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

export interface TreeDestination {
  parentId: string | null;
  index: number;
}

export type RowDropIntent = 'before' | 'after' | 'inside';

export type RowDropVisualIntent = RowDropIntent | 'inside-pending';

export type DropRegion =
  { kind: 'edge'; intent: 'before' | 'after' } | { kind: 'middle' };

export interface TreeMoveProjection {
  documents: WorkspaceDocument[];
  movedIds: ReadonlySet<string>;
  affectedIds: ReadonlySet<string>;
  changed: boolean;
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
  const visited = new Set([documentId]);
  const pending = [documentId];
  while (pending.length > 0) {
    const parentId = pending.pop();
    for (const document of documents) {
      if (document.parent_id === parentId && !visited.has(document.id)) {
        visited.add(document.id);
        descendants.add(document.id);
        pending.push(document.id);
      }
    }
  }
  return descendants;
}

export function destinationForRow(
  documents: WorkspaceDocument[],
  documentId: string,
  targetId: string,
  intent: RowDropIntent,
): TreeDestination | null {
  const source = documents.find(({ id }) => id === documentId);
  const target = documents.find(({ id }) => id === targetId);
  if (
    !source ||
    !target ||
    source.archived_at !== null ||
    target.archived_at !== null ||
    !source.can_edit ||
    !target.can_edit ||
    source.workspace_id !== target.workspace_id ||
    source.project_id !== target.project_id ||
    source.id === target.id ||
    descendantIds(documents, source.id).has(target.id)
  ) {
    return null;
  }

  if (intent === 'inside') {
    return {
      parentId: target.id,
      index: activeSiblings(documents, source, target.id, source.id).length,
    };
  }

  const siblings = activeSiblings(
    documents,
    source,
    target.parent_id,
    source.id,
  );
  const targetIndex = siblings.findIndex(({ id }) => id === target.id);
  if (targetIndex < 0) return null;
  return {
    parentId: target.parent_id,
    index: targetIndex + (intent === 'after' ? 1 : 0),
  };
}

export function moveTreeNode(
  documents: WorkspaceDocument[],
  move: { documentId: string; destination: TreeDestination },
): TreeMoveProjection | null {
  const source = documents.find(({ id }) => id === move.documentId);
  if (!source || source.archived_at !== null || !source.can_edit) return null;
  const { parentId, index } = move.destination;
  if (!Number.isInteger(index) || index < 0) return null;

  const movedIds = descendantIds(documents, source.id);
  movedIds.add(source.id);
  if (parentId && movedIds.has(parentId)) return null;

  const parent = parentId ? documents.find(({ id }) => id === parentId) : null;
  if (
    parentId &&
    (!parent ||
      parent.archived_at !== null ||
      !parent.can_edit ||
      parent.workspace_id !== source.workspace_id ||
      parent.project_id !== source.project_id)
  ) {
    return null;
  }

  const oldSiblings = activeSiblings(
    documents,
    source,
    source.parent_id,
    source.id,
  );
  const destinationSiblings =
    parentId === source.parent_id
      ? oldSiblings
      : activeSiblings(documents, source, parentId, source.id);
  if (index > destinationSiblings.length) return null;

  const orderedDestination = [...destinationSiblings];
  orderedDestination.splice(index, 0, source);
  const placements = new Map<
    string,
    { parentId: string | null; position: number }
  >();
  if (parentId !== source.parent_id) {
    oldSiblings.forEach((document, position) => {
      placements.set(document.id, {
        parentId: source.parent_id,
        position,
      });
    });
  }
  orderedDestination.forEach((document, position) => {
    placements.set(document.id, { parentId, position });
  });

  let changed = false;
  const projected = documents.map((document) => {
    const placement = placements.get(document.id);
    if (!placement) return document;
    if (
      document.parent_id === placement.parentId &&
      document.position === placement.position
    ) {
      return document;
    }
    changed = true;
    return {
      ...document,
      parent_id: placement.parentId,
      position: placement.position,
    };
  });
  return {
    documents: projected,
    movedIds,
    affectedIds: new Set([...movedIds, ...placements.keys()]),
    changed,
  };
}

export function dropRegion(
  rowTop: number,
  rowHeight: number,
  pointerY: number,
  previousRegion?: DropRegion,
): DropRegion {
  const height = Math.max(1, rowHeight);
  const edge = Math.min(8, height * 0.25);
  const hysteresis = Math.min(2, height * 0.0625);
  const beforeBoundary = rowTop + edge;
  const afterBoundary = rowTop + height - edge;

  if (
    previousRegion?.kind === 'middle' &&
    pointerY > beforeBoundary - hysteresis &&
    pointerY < afterBoundary + hysteresis
  ) {
    return previousRegion;
  }
  if (
    previousRegion?.kind === 'edge' &&
    previousRegion.intent === 'before' &&
    pointerY <= beforeBoundary + hysteresis
  ) {
    return previousRegion;
  }
  if (
    previousRegion?.kind === 'edge' &&
    previousRegion.intent === 'after' &&
    pointerY >= afterBoundary - hysteresis
  ) {
    return previousRegion;
  }

  if (pointerY <= beforeBoundary) return { kind: 'edge', intent: 'before' };
  if (pointerY >= afterBoundary) {
    return { kind: 'edge', intent: 'after' };
  }
  return { kind: 'middle' };
}

export function sameDestination(
  left: TreeDestination | null,
  right: TreeDestination | null,
) {
  return left?.parentId === right?.parentId && left?.index === right?.index;
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

function activeSiblings(
  documents: WorkspaceDocument[],
  scope: Pick<WorkspaceDocument, 'workspace_id' | 'project_id'>,
  parentId: string | null,
  excludedId: string,
) {
  return documents
    .filter(
      (candidate) =>
        candidate.id !== excludedId &&
        candidate.archived_at === null &&
        candidate.workspace_id === scope.workspace_id &&
        candidate.project_id === scope.project_id &&
        candidate.parent_id === parentId,
    )
    .sort(compareDocuments);
}
