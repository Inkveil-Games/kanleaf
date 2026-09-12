import { createContext, useContext, useEffect } from 'react';

export type SetRealtimeWorkspace = (workspaceId: string | null) => () => void;

export const RealtimeWorkspaceContext = createContext<SetRealtimeWorkspace>(
  () => () => {},
);

export function useRealtimeWorkspace(workspaceId: string | null) {
  const setWorkspace = useContext(RealtimeWorkspaceContext);
  useEffect(() => setWorkspace(workspaceId), [setWorkspace, workspaceId]);
}
