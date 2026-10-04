import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionGraph } from './ExecutionGraph';
import { graphTask } from './testFixtures';
import { defaultGraphViewSettings } from './types';
import * as layout from './graphLayout';
import ELK from 'elkjs/lib/elk.bundled.js';

vi.mock('./graphLayoutWorker', () => ({
  createGraphLayoutEngine: () => new ELK(),
}));

describe('Execution Graph', () => {
  it('announces layout failures and retries without changing task data', async () => {
    const arrange = vi
      .spyOn(layout, 'layoutExecutionGraph')
      .mockRejectedValueOnce(new Error('worker failed'));
    render(
      <ExecutionGraph
        tasks={[graphTask('api')]}
        selectedTaskId={null}
        onSelectTask={vi.fn()}
        settings={defaultGraphViewSettings}
        onSettingsChange={vi.fn()}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Use Re-layout');
    fireEvent.click(screen.getByRole('button', { name: 'Re-layout' }));
    expect(
      await screen.findByRole('button', { name: '#api api, Ready' }),
    ).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    arrange.mockRestore();
  });

  it('ignores an obsolete asynchronous layout after the task set changes', async () => {
    let resolveOld: ((value: layout.GraphLayout) => void) | undefined;
    const arrange = vi
      .spyOn(layout, 'layoutExecutionGraph')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      );
    const props = {
      selectedTaskId: null,
      onSelectTask: vi.fn(),
      settings: defaultGraphViewSettings,
      onSettingsChange: vi.fn(),
    };
    const { rerender } = render(
      <ExecutionGraph {...props} tasks={[graphTask('old')]} />,
    );
    rerender(<ExecutionGraph {...props} tasks={[graphTask('new')]} />);
    expect(
      await screen.findByRole('button', { name: '#new new, Ready' }),
    ).toBeVisible();
    await act(async () => {
      resolveOld?.({
        positions: { old: { x: 0, y: 0 } },
        routes: {},
        cornerRadii: {},
        frontierY: 100,
        width: 600,
      });
    });
    expect(
      screen.getByRole('button', { name: '#new new, Ready' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: '#old old, Ready' }),
    ).not.toBeInTheDocument();
    arrange.mockRestore();
  });
  it('renders readable task states, routes selection, and keeps layout stable across detail/title updates', async () => {
    const onSelectTask = vi.fn();
    const tasks = [graphTask('schema', {}, 'done'), graphTask('api')];
    const relayout = vi.spyOn(layout, 'layoutExecutionGraph');
    const props = {
      tasks,
      selectedTaskId: null,
      onSelectTask,
      settings: defaultGraphViewSettings,
      onSettingsChange: vi.fn(),
    };
    const { rerender } = render(<ExecutionGraph {...props} />);
    fireEvent.click(
      await screen.findByRole('button', { name: '#api api, Ready' }),
    );
    expect(onSelectTask).toHaveBeenCalledWith('api');
    fireEvent.keyDown(
      screen.getByRole('button', { name: '#schema schema, Done' }),
      { key: 'Enter' },
    );
    expect(onSelectTask).toHaveBeenCalledWith('schema');
    rerender(
      <ExecutionGraph
        {...props}
        selectedTaskId="api"
        tasks={tasks.map((task) => ({
          ...task,
          title: task.id === 'api' ? 'Renamed' : task.title,
        }))}
      />,
    );
    expect(
      screen.getByRole('button', { name: '#api Renamed, Ready' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(relayout).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Re-layout' }));
    expect(relayout).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Fit graph' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: /Edit graph|Connect|Delete edge/ }),
    ).not.toBeInTheDocument();
    relayout.mockRestore();
  });

  it('changes presentation settings without changing tasks or relayout', () => {
    const onSettingsChange = vi.fn();
    const tasks = [graphTask('done', {}, 'done')];
    const props = {
      tasks,
      selectedTaskId: null,
      onSelectTask: vi.fn(),
      settings: defaultGraphViewSettings,
      onSettingsChange,
    };
    const { rerender } = render(<ExecutionGraph {...props} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Parent' }));
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...defaultGraphViewSettings,
      showParentEdges: false,
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Blocks' }));
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...defaultGraphViewSettings,
      showBlockEdges: false,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Completed: Show' }));
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...defaultGraphViewSettings,
      showCompleted: false,
    });
    rerender(
      <ExecutionGraph
        {...props}
        settings={{ ...defaultGraphViewSettings, showCompleted: false }}
      />,
    );
    expect(
      screen.queryByRole('button', { name: '#done done, Done' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('All tasks are completed.')).toBeInTheDocument();
  });
});
