export interface HealthResponse {
  status: 'ok';
  service: 'kanleaf';
  version: string;
}

export interface User {
  id: string;
  email: string;
  active_workspace_id: string | null;
}

export interface AuthResponse {
  token: string;
  expires_at: string;
  user: User;
}

export interface SessionResponse {
  expires_at: string;
  user: User;
}
