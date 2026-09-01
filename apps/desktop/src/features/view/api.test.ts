import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSavedView } from './api';
import type { SavedView } from './types';

describe('getSavedView', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches one encoded workspace view with the current session token', async () => {
    const savedView: SavedView = {
      id: 'view?mine#1',
      workspace_id: 'workspace/alpha',
      project_id: null,
      owner_id: 'user-1',
      name: 'My focused work',
      visibility: 'personal',
      query_version: 1,
      query: {
        version: 1,
        scope: { kind: 'workspace' },
        search: 'release',
        filters: {
          states: { values: [], include_none: false },
          state_groups: [],
          task_types: { values: [], include_none: false },
          priorities: [],
          assignees: { values: [], include_none: false },
          labels: { values: [], include_none: false },
          projects: { values: [], include_none: false },
          cycles: { values: [], include_none: false },
          modules: { values: [], include_none: false },
          start_date: { from: null, to: null, include_none: false },
          due_date: { from: null, to: null, include_none: false },
          estimate: { minimum: null, maximum: null, include_none: false },
        },
        grouping: { primary: null, secondary: null },
        sort: [],
        display: ['state', 'priority'],
        include_completed: true,
      },
      layout: 'list',
      created_at: '2026-09-01T08:00:00Z',
      updated_at: '2026-09-01T09:00:00Z',
    };
    let request: { url: string; init: RequestInit } | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        request = { url, init };
        return Promise.resolve(
          new Response(JSON.stringify(savedView), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }),
    );

    const result = await getSavedView(
      { serverUrl: 'https://kanleaf.example.com', token: 'session-token' },
      'workspace/alpha',
      'view?mine#1',
    );

    expect(request?.url).toBe(
      'https://kanleaf.example.com/api/workspaces/workspace%2Falpha/views/view%3Fmine%231',
    );
    expect(request?.init.method).toBeUndefined();
    expect(request?.init.body).toBeUndefined();
    expect(new Headers(request?.init.headers).get('authorization')).toBe(
      'Bearer session-token',
    );
    expect(result).toEqual(savedView);
  });
});
