import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TaskPriority, TaskState } from '../workspace/types';
import { PriorityBadge, PriorityIcon, StateIcon } from './TaskValueIcon';

const stateRoles: TaskState['system_role'][] = [
  'backlog',
  'todo',
  'in_progress',
  'done',
  'cancelled',
];

const priorities: TaskPriority[] = [
  'none',
  'low',
  'medium',
  'high',
  'critical',
];

describe('TaskValueIcon', () => {
  it('maps every fixed State role to a decorative theme-aware icon', () => {
    const { container } = render(
      <>
        {stateRoles.map((role) => (
          <StateIcon key={role} role={role} size={30} />
        ))}
      </>,
    );

    for (const role of stateRoles) {
      const icon = container.querySelector(`[data-state-role="${role}"]`);
      expect(icon).toHaveClass('task-state-icon', `is-${role}`);
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(icon).toHaveStyle({ width: '30px', height: '30px' });
    }
  });

  it('maps every Priority to its supplied SVG without masking it', () => {
    const { container } = render(
      <>
        {priorities.map((priority) => (
          <PriorityIcon key={priority} priority={priority} size={15} />
        ))}
      </>,
    );

    for (const priority of priorities) {
      const icon = container.querySelector(
        `[data-priority-value="${priority}"]`,
      );
      expect(icon).toBeInstanceOf(HTMLImageElement);
      expect(icon).toHaveClass('task-priority-icon', `is-${priority}`);
      expect(icon).toHaveAttribute('alt', '');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(icon).toHaveAttribute('width', '15');
      expect(icon).toHaveAttribute('height', '15');
    }
  });

  it('renders a borderless semantic badge with the canonical label', () => {
    render(<PriorityBadge priority="critical" />);

    const badge = screen.getByText('Critical').parentElement;
    expect(badge).toHaveClass('task-priority-badge', 'is-critical');
    expect(badge).toHaveAttribute('data-priority-value', 'critical');
    expect(badge?.querySelector('img')).toHaveAttribute(
      'data-priority-value',
      'critical',
    );
  });
});
