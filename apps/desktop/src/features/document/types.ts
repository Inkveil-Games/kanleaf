export interface WorkspaceDocument {
  id: string;
  workspace_id: string;
  project_id: string | null;
  parent_id: string | null;
  title: string;
  position: number;
  can_edit: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentPatch {
  title?: string;
  project_id?: string | null;
  parent_id?: string | null;
  position?: number;
}
