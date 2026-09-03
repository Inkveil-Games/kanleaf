import { DragDropProvider } from '@dnd-kit/react';
import { isSortable, useSortable } from '@dnd-kit/react/sortable';
import { GripVertical } from 'lucide-react';
import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  type RefCallback,
} from 'react';
import { reorderSettingsIds } from './settingsSortable';

const SortableDisabledContext = createContext(false);

export function SettingsSortableProvider({
  children,
  disabled = false,
  ids,
  onReorder,
}: {
  children: ReactNode;
  disabled?: boolean;
  ids: string[];
  onReorder: (ids: string[]) => Promise<void> | void;
}) {
  const [persisting, setPersisting] = useState(false);
  const sortingDisabled = disabled || persisting;

  return (
    <SortableDisabledContext.Provider value={sortingDisabled}>
      <DragDropProvider
        onDragEnd={(event) => {
          if (event.canceled || sortingDisabled) return;
          const { source } = event.operation;
          if (!isSortable(source)) return;
          const { initialIndex, index } = source;
          if (initialIndex === index) return;
          const reordered = reorderSettingsIds(ids, initialIndex, index);
          setPersisting(true);
          void Promise.resolve(onReorder(reordered)).finally(() =>
            setPersisting(false),
          );
        }}
      >
        {children}
      </DragDropProvider>
    </SortableDisabledContext.Provider>
  );
}

export function SettingsSortableRow({
  children,
  disabled = false,
  id,
  index,
  label,
}: {
  children: ReactNode;
  disabled?: boolean;
  id: string;
  index: number;
  label: string;
}) {
  return (
    <SettingsSortableItem id={id} index={index} disabled={disabled}>
      {({ ref, handleRef, isDragging, sortingDisabled }) => (
        <div
          ref={ref}
          className={`settings-list-row settings-sortable-row${isDragging ? ' is-dragging' : ''}`}
          role="listitem"
        >
          <div className="settings-list-cell settings-drag-cell">
            <SettingsDragHandle
              ref={handleRef}
              label={label}
              disabled={sortingDisabled}
            />
          </div>
          {children}
        </div>
      )}
    </SettingsSortableItem>
  );
}

export function SettingsSortableItem({
  children,
  disabled = false,
  id,
  index,
}: {
  children: (state: {
    ref: RefCallback<HTMLElement>;
    handleRef: RefCallback<HTMLElement>;
    isDragging: boolean;
    sortingDisabled: boolean;
  }) => ReactNode;
  disabled?: boolean;
  id: string;
  index: number;
}) {
  const providerDisabled = useContext(SortableDisabledContext);
  const sortingDisabled = disabled || providerDisabled;
  const { ref, handleRef, isDragging } = useSortable({
    id,
    index,
    group: 'workspace-settings',
    type: 'workspace-setting',
    accept: 'workspace-setting',
    disabled: sortingDisabled,
  });

  return children({ ref, handleRef, isDragging, sortingDisabled });
}

export function SettingsDragHandle({
  ref,
  label,
  disabled,
}: {
  ref?: RefCallback<HTMLElement>;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      ref={ref as RefCallback<HTMLButtonElement>}
      className="settings-drag-handle"
      type="button"
      aria-label={`Reorder ${label}`}
      disabled={disabled}
      title="Drag or press Space, then use arrow keys"
    >
      <GripVertical aria-hidden="true" size={15} />
    </button>
  );
}
