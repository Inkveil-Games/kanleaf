import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  MarkerType,
  useReactFlow,
} from '@xyflow/react';
import { Maximize, Minus, Plus, RotateCcw } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { IconButton } from '../../components/ui/IconButton';
import { Tooltip } from '../../components/ui/Tooltip';
import { EmptyState } from '../../components/ui/EmptyState';
import type { Task } from '../workspace/types';
import {
  ExecutionGraphNode,
  type ExecutionFlowNode,
} from './ExecutionGraphNode';
import {
  ExecutionGraphEdge,
  type ExecutionFlowEdge,
} from './ExecutionGraphEdge';
import { CompletionFrontier } from './CompletionFrontier';
import { projectExecutionGraph, visibleGraph } from './graphProjection';
import {
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  graphLayoutKey,
  layoutExecutionGraph,
  type GraphLayout,
} from './graphLayout';
import { executionStateLabels } from './executionState';
import type { GraphViewSettings } from './types';
import '@xyflow/react/dist/base.css';
import './ExecutionGraph.css';

const nodeTypes = { execution: ExecutionGraphNode };
const edgeTypes = { execution: ExecutionGraphEdge };
const initialFitOptions = { padding: 0.15, minZoom: 0.8, maxZoom: 1 };
const ariaLabelConfig = {
  'node.a11yDescription.default':
    'Press Enter or Space to open task details. Use Tab to move between tasks.',
};

interface ExecutionGraphProps {
  tasks: Task[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  settings: GraphViewSettings;
  onSettingsChange: (settings: GraphViewSettings) => void;
}

export function ExecutionGraph(props: ExecutionGraphProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvas {...props} />
    </ReactFlowProvider>
  );
}

function GraphCanvas({
  tasks,
  selectedTaskId,
  onSelectTask,
  settings,
  onSettingsChange,
}: ExecutionGraphProps) {
  const projection = useMemo(() => projectExecutionGraph(tasks), [tasks]);
  const key = graphLayoutKey(projection);
  const [request, setRequest] = useState(() => ({ key, projection }));
  if (request.key !== key) setRequest({ key, projection });
  const [positioned, setPositioned] = useState<GraphLayout | null>(null);
  const [failedRequest, setFailedRequest] = useState<typeof request | null>(
    null,
  );
  useEffect(() => {
    let obsolete = false;
    void layoutExecutionGraph(request.projection).then(
      (layout) => {
        if (!obsolete) setPositioned(layout);
      },
      () => {
        if (!obsolete) setFailedRequest(request);
      },
    );
    return () => {
      obsolete = true;
    };
  }, [request]);
  const visible = useMemo(
    () => visibleGraph(projection, settings),
    [projection, settings],
  );
  const nodes = useMemo<ExecutionFlowNode[]>(
    () =>
      visible.nodes
        .filter((node) => positioned?.positions[node.id])
        .map((node) => ({
          id: node.id,
          type: 'execution',
          data: { node },
          position: positioned?.positions[node.id] ?? { x: 0, y: 0 },
          width: GRAPH_NODE_WIDTH,
          height: GRAPH_NODE_HEIGHT,
          selected: node.id === selectedTaskId,
          ariaRole: 'button',
          ariaLabel: `${node.task.reference} ${node.task.title}, ${executionStateLabels[node.executionState]}`,
          domAttributes: { 'aria-pressed': node.id === selectedTaskId },
          draggable: false,
          connectable: false,
          deletable: false,
        })),
    [visible.nodes, positioned, selectedTaskId],
  );
  const edges = useMemo<ExecutionFlowEdge[]>(
    () =>
      visible.edges
        .filter((edge) => positioned?.routes[edge.id])
        .map((edge) => ({
          ...edge,
          data: { kind: edge.kind, route: positioned?.routes[edge.id] ?? [] },
          type: 'execution',
          className: `execution-edge-${edge.kind}`,
          deletable: false,
          selectable: false,
          ariaLabel:
            edge.kind === 'blocks'
              ? 'Blocking dependency'
              : 'Parent / child relation',
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: 'var(--color-text-muted)',
            width: 18,
            height: 18,
          },
        })),
    [visible.edges, positioned],
  );
  const { fitView, zoomIn, zoomOut, getViewport, setViewport } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let previous = canvas.getBoundingClientRect();
    const observer = new ResizeObserver(() => {
      const next = canvas.getBoundingClientRect();
      if (
        previous.width > 0 &&
        previous.height > 0 &&
        (next.width !== previous.width || next.height !== previous.height)
      ) {
        const viewport = getViewport();
        void setViewport(
          {
            ...viewport,
            x: viewport.x + (next.width - previous.width) / 2,
            y: viewport.y + (next.height - previous.height) / 2,
          },
          { duration: 0 },
        );
      }
      previous = next;
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [getViewport, setViewport]);
  function openWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (
      !(event.target instanceof HTMLElement) ||
      !['Enter', ' '].includes(event.key)
    )
      return;
    const id = event.target
      .closest('.react-flow__node')
      ?.getAttribute('data-id');
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectTask(id);
  }
  return (
    <section className="execution-graph" aria-label="Execution Graph">
      <div className="execution-graph-toolbar" aria-label="Graph controls">
        <fieldset>
          <legend>Relations</legend>
          <label>
            <Checkbox
              checked={settings.showParentEdges}
              onCheckedChange={(value) =>
                onSettingsChange({ ...settings, showParentEdges: value })
              }
            />
            Parent
          </label>
          <label>
            <Checkbox
              checked={settings.showBlockEdges}
              onCheckedChange={(value) =>
                onSettingsChange({ ...settings, showBlockEdges: value })
              }
            />
            Blocks
          </label>
        </fieldset>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={settings.showCompleted}
          onClick={() =>
            onSettingsChange({
              ...settings,
              showCompleted: !settings.showCompleted,
            })
          }
        >
          Completed: {settings.showCompleted ? 'Show' : 'Hide'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRequest({ key, projection })}
        >
          <RotateCcw size={14} aria-hidden="true" />
          Re-layout
        </Button>
        <div className="execution-viewport-controls">
          <Tooltip
            label="Fit graph"
            trigger={
              <IconButton
                aria-label="Fit graph"
                onClick={() => void fitView({ padding: 0.15, duration: 0 })}
              >
                <Maximize size={15} />
              </IconButton>
            }
          />
          <Tooltip
            label="Zoom out"
            trigger={
              <IconButton
                aria-label="Zoom out"
                onClick={() => void zoomOut({ duration: 0 })}
              >
                <Minus size={15} />
              </IconButton>
            }
          />
          <Tooltip
            label="Zoom in"
            trigger={
              <IconButton
                aria-label="Zoom in"
                onClick={() => void zoomIn({ duration: 0 })}
              >
                <Plus size={15} />
              </IconButton>
            }
          />
        </div>
      </div>
      <div
        ref={canvasRef}
        className="execution-graph-canvas"
        onKeyDownCapture={openWithKeyboard}
      >
        <ReactFlow<ExecutionFlowNode>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={(_event, node) => onSelectTask(node.id)}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesReconnectable={false}
          edgesFocusable={false}
          deleteKeyCode={null}
          selectionOnDrag={false}
          fitView
          fitViewOptions={initialFitOptions}
          minZoom={0.15}
          maxZoom={2}
          ariaLabelConfig={ariaLabelConfig}
        >
          {positioned && (
            <CompletionFrontier
              y={positioned.frontierY}
              width={positioned.width}
              completed={projection.completion.completed}
            />
          )}
        </ReactFlow>
        {failedRequest === request ? (
          <p className="execution-graph-hint" role="alert">
            Unable to arrange Graph. Use Re-layout to try again.
          </p>
        ) : !positioned && visible.nodes.length > 0 ? (
          <p className="execution-graph-hint" role="status">
            Arranging Graph…
          </p>
        ) : null}
        {visible.nodes.length === 0 && (
          <div className="execution-graph-empty">
            <EmptyState
              title={
                tasks.length
                  ? 'All tasks are completed.'
                  : 'No tasks in this Graph.'
              }
              description={
                tasks.length
                  ? 'Show completed tasks to see the full graph.'
                  : 'Change the view filters or create a task.'
              }
            />
          </div>
        )}
        {visible.nodes.length > 0 && visible.edges.length === 0 && (
          <p className="execution-graph-hint">
            No visible relations. Tasks remain in this view’s query scope.
          </p>
        )}
      </div>
    </section>
  );
}
