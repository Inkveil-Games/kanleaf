export interface HealthResponse {
  status: 'ok';
  service: 'kanleaf';
  version: string;
}

export interface User {
  id: string;
  email: string;
  display_name: string;
  is_host: boolean;
  theme: 'system' | 'light' | 'dark';
  timezone: string;
  week_start: 'monday' | 'sunday';
  date_format: 'locale' | 'yyyy_mm_dd' | 'dd_mm_yyyy' | 'mm_dd_yyyy';
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
