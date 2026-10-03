import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionGraph } from './ExecutionGraph';
import { graphTask } from './testFixtures';
import { defaultGraphViewSettings } from './types';
import * as layout from './graphLayout';

describe('Execution Graph', () => {
  it('renders readable task states, routes selection, and keeps layout stable across detail/title updates', () => {
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
    fireEvent.click(screen.getByRole('button', { name: '#api api, Ready' }));
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
