import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

const STORAGE_KEY = 'kanleaf.workspace-pane-layout';
const NARROW_QUERY = '(max-width: 1080px)';
const TASK_DETAIL_DRAWER_MIN = 560;
const TASK_DETAIL_DRAWER_MAX = 1100;
const TASK_DETAIL_DRAWER_DEFAULT_RATIO = 0.58;
const TASK_DETAIL_DRAWER_MAX_RATIO = 0.75;
const MIN_VISIBLE_TASK_SURFACE = 160;

export interface PaneLimits {
  min: number;
  max: number;
  defaultValue: number;
}

export const PANE_LIMITS = {
  navigation: { min: 180, max: 320, defaultValue: 226 },
  collection: { min: 300, max: 560, defaultValue: 360 },
} satisfies Record<string, PaneLimits>;

interface PanePreferences {
  navigationWidth: number;
  collectionWidth: number;
  taskDetailDrawerWidth?: number;
  navigationCollapsed: boolean;
}

export type NavigationMode = 'expanded' | 'rail' | 'drawer';

export function useWorkspacePaneLayout() {
  const [preferences, setPreferences] = useState(readPreferences);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const viewportWidth = useViewportWidth();
  const resetDrawer = useCallback(() => setDrawerOpen(false), []);
  const narrow = useMediaQuery(NARROW_QUERY, resetDrawer);

  useEffect(() => {
    writePreferences(preferences);
  }, [preferences]);

  const navigationMode: NavigationMode = narrow
    ? drawerOpen
      ? 'drawer'
      : 'rail'
    : preferences.navigationCollapsed
      ? 'rail'
      : 'expanded';
  const taskDetailDrawerLimits = useMemo(
    () =>
      createTaskDetailDrawerLimits(
        viewportWidth,
        navigationMode === 'expanded'
          ? preferences.navigationWidth
          : readNavigationRailWidth(),
      ),
    [navigationMode, preferences.navigationWidth, viewportWidth],
  );
  const taskDetailDrawerWidth = constrain(
    preferences.taskDetailDrawerWidth,
    taskDetailDrawerLimits,
    taskDetailDrawerLimits.defaultValue,
  );
  const closeNavigationDrawer = useCallback(() => setDrawerOpen(false), []);
  const setNavigationWidth = useCallback(
    (next: SetStateAction<number>) =>
      setPaneWidth(
        setPreferences,
        'navigationWidth',
        PANE_LIMITS.navigation,
        next,
      ),
    [],
  );
  const setCollectionWidth = useCallback(
    (next: SetStateAction<number>) =>
      setPaneWidth(
        setPreferences,
        'collectionWidth',
        PANE_LIMITS.collection,
        next,
      ),
    [],
  );
  const setTaskDetailDrawerWidth = useCallback((next: number) => {
    setPreferences((current) => ({
      ...current,
      taskDetailDrawerWidth: constrain(next, {
        min: TASK_DETAIL_DRAWER_MIN,
        max: TASK_DETAIL_DRAWER_MAX,
        defaultValue: TASK_DETAIL_DRAWER_MIN,
      }),
    }));
  }, []);
  const resetTaskDetailDrawerWidth = useCallback(() => {
    setPreferences((current) => {
      if (current.taskDetailDrawerWidth === undefined) return current;
      const next = { ...current };
      delete next.taskDetailDrawerWidth;
      return next;
    });
  }, []);
  const toggleNavigation = useCallback(() => {
    if (narrow) {
      setDrawerOpen((current) => !current);
    } else {
      setPreferences((current) => ({
        ...current,
        navigationCollapsed: !current.navigationCollapsed,
      }));
    }
  }, [narrow]);

  return {
    ...preferences,
    taskDetailDrawerWidth,
    taskDetailDrawerLimits,
    narrow,
    navigationMode,
    setNavigationWidth,
    setCollectionWidth,
    setTaskDetailDrawerWidth,
    resetTaskDetailDrawerWidth,
    toggleNavigation,
    closeNavigationDrawer,
  };
}

function setPaneWidth(
  setPreferences: Dispatch<SetStateAction<PanePreferences>>,
  key: 'navigationWidth' | 'collectionWidth',
  limits: PaneLimits,
  next: SetStateAction<number>,
) {
  setPreferences((current) => ({
    ...current,
    [key]: constrain(
      typeof next === 'function' ? next(current[key]) : next,
      limits,
    ),
  }));
}

function useMediaQuery(query: string, onChange: () => void) {
  const [matches, setMatches] = useState(() =>
    typeof matchMedia === 'function' ? matchMedia(query).matches : false,
  );

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia(query);
    const changed = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
      onChange();
    };
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, [onChange, query]);

  return matches;
}

function useViewportWidth() {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth,
  );

  useEffect(() => {
    const resized = () => setWidth(window.innerWidth);
    window.addEventListener('resize', resized);
    return () => window.removeEventListener('resize', resized);
  }, []);

  return width;
}

function createTaskDetailDrawerLimits(
  viewportWidth: number,
  navigationWidth: number,
): PaneLimits {
  const taskSurfaceWidth = Math.max(0, viewportWidth - navigationWidth);
  const max = Math.max(
    TASK_DETAIL_DRAWER_MIN,
    Math.min(
      TASK_DETAIL_DRAWER_MAX,
      Math.round(viewportWidth * TASK_DETAIL_DRAWER_MAX_RATIO),
      Math.round(taskSurfaceWidth - MIN_VISIBLE_TASK_SURFACE),
    ),
  );
  return {
    min: TASK_DETAIL_DRAWER_MIN,
    max,
    defaultValue: Math.min(
      max,
      Math.max(
        TASK_DETAIL_DRAWER_MIN,
        Math.round(viewportWidth * TASK_DETAIL_DRAWER_DEFAULT_RATIO),
      ),
    ),
  };
}

function readNavigationRailWidth() {
  if (typeof document === 'undefined') return 44;
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(
      '--navigation-rail-width',
    ),
  );
  return Number.isFinite(value) ? value : 44;
}

function readPreferences(): PanePreferences {
  const defaults: PanePreferences = {
    navigationWidth: PANE_LIMITS.navigation.defaultValue,
    collectionWidth: PANE_LIMITS.collection.defaultValue,
    navigationCollapsed: false,
  };
  try {
    const stored = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? '{}',
    ) as Partial<PanePreferences>;
    return {
      navigationWidth: constrain(
        stored.navigationWidth,
        PANE_LIMITS.navigation,
        defaults.navigationWidth,
      ),
      collectionWidth: constrain(
        stored.collectionWidth,
        PANE_LIMITS.collection,
        defaults.collectionWidth,
      ),
      ...(typeof stored.taskDetailDrawerWidth === 'number' &&
      Number.isFinite(stored.taskDetailDrawerWidth)
        ? {
            taskDetailDrawerWidth: constrain(stored.taskDetailDrawerWidth, {
              min: TASK_DETAIL_DRAWER_MIN,
              max: TASK_DETAIL_DRAWER_MAX,
              defaultValue: TASK_DETAIL_DRAWER_MIN,
            }),
          }
        : {}),
      navigationCollapsed: stored.navigationCollapsed === true,
    };
  } catch {
    return defaults;
  }
}

function writePreferences(preferences: PanePreferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Pane sizing remains usable for the current session without local storage.
  }
}

function constrain(
  value: number | undefined,
  limits: PaneLimits,
  fallback = limits.defaultValue,
) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)));
}
