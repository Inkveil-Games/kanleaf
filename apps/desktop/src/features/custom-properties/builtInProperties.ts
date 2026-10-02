export const BUILT_IN_PROPERTIES = [
  {
    key: 'state',
    name: 'State',
    type: 'single_select',
    description: 'The current stage of work.',
  },
  {
    key: 'priority',
    name: 'Priority',
    type: 'single_select',
    description: 'How urgent the Task is.',
  },
  {
    key: 'start-date',
    name: 'Start date',
    type: 'date',
    description: 'When work is planned to start.',
  },
  {
    key: 'due-date',
    name: 'Due date',
    type: 'date',
    description: 'When the Task is due.',
  },
] as const;

export type BuiltInProperty = (typeof BUILT_IN_PROPERTIES)[number];
