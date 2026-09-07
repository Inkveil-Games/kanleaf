export interface WorkspaceDocument {
  id: string;
  document_number: number;
  workspace_id: string;
  project_id: string | null;
  parent_id: string | null;
  title: string;
  storage_name: string;
  library_path: string;
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
