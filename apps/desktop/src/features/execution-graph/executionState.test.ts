import { describe, expect, it } from 'vitest';
import { executionStateLabel, taskExecutionState } from './executionState';
import { graphTask } from './testFixtures';

describe('Graph workflow labels', () => {
  it.each(['todo', 'in_progress', 'done', 'cancelled'] as const)(
    'uses the configured state name for %s',
    (role) => {
      const task = graphTask('task', {}, role);
      expect(executionStateLabel(task, taskExecutionState(task, false))).toBe(
        'Custom workflow name',
      );
    },
  );

  it('overrides the workflow label only while unfinished work is blocked', () => {
    const task = graphTask('task', {}, 'in_progress');
    expect(executionStateLabel(task, taskExecutionState(task, true))).toBe(
      'Blocked',
    );
    expect(executionStateLabel(task, taskExecutionState(task, false))).toBe(
      task.state.name,
    );
    const completed = graphTask('done', {}, 'done');
    expect(
      executionStateLabel(completed, taskExecutionState(completed, true)),
    ).toBe(completed.state.name);
  });
});
