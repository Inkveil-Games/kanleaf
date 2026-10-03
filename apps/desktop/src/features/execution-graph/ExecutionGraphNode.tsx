import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { LockKeyhole } from 'lucide-react';
import { Avatar } from '../../components/ui/Avatar';
import { PriorityIcon, StateIcon } from '../task/TaskValueIcon';
import { priorityLabel } from '../task/taskPropertyModel';
import { executionStateLabels } from './executionState';
import type { GraphTaskNode } from './types';

export type ExecutionFlowNode = Node<{ node: GraphTaskNode }, 'execution'>;

export const ExecutionGraphNode = memo(function ExecutionGraphNode({
  data,
}: NodeProps<ExecutionFlowNode>) {
  const { task, executionState } = data.node;
  const assignee = task.assignees[0];
  return (
    <div className="execution-graph-node" data-execution-state={executionState}>
      <Handle type="source" position={Position.Top} isConnectable={false} />
      <span className="execution-node-reference">{task.reference}</span>
      <span className="execution-node-title" title={task.title}>
        {task.title}
      </span>
      <span className="execution-node-state">
        {executionState === 'blocked' ? (
          <LockKeyhole size={13} aria-hidden="true" />
        ) : (
          <StateIcon role={task.state.system_role} size={14} />
        )}
        {executionStateLabels[executionState]}
      </span>
      <span className="execution-node-metadata">
        <span title={priorityLabel(task.priority)}>
          <PriorityIcon priority={task.priority} size={15} />
        </span>
        {assignee && (
          <Avatar
            name={assignee.display_name || assignee.email}
            fallback="?"
            size="xs"
          />
        )}
        {task.assignees.length > 1 && (
          <small>+{task.assignees.length - 1}</small>
        )}
      </span>
      <Handle type="target" position={Position.Bottom} isConnectable={false} />
    </div>
  );
});
