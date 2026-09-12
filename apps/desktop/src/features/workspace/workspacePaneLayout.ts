import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

const STORAGE_KEY = 'kanleaf.workspace-pane-layout';
const NARROW_QUERY = '(max-width: 1080px)';

export interface PaneLimits {
  min: number;
  max: number;
  defaultValue: number;
}

export const PANE_LIMITS = {
  navigation: { min: 180, max: 320, defaultValue: 226 },
  collection: { min: 300, max: 560, defaultValue: 360 },
  detail: { min: 340, max: 720, defaultValue: 440 },
} satisfies Record<string, PaneLimits>;

interface PanePreferences {
  navigationWidth: number;
  collectionWidth: number;
  detailWidth: number;
  navigationCollapsed: boolean;
}

export type NavigationMode = 'expanded' | 'rail' | 'drawer';

export function useWorkspacePaneLayout() {
  const [preferences, setPreferences] = useState(readPreferences);
  const [drawerOpen, setDrawerOpen] = useState(false);
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
  const setDetailWidth = useCallback(
    (next: SetStateAction<number>) =>
      setPaneWidth(setPreferences, 'detailWidth', PANE_LIMITS.detail, next),
    [],
  );
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
    narrow,
    navigationMode,
    setNavigationWidth,
    setCollectionWidth,
    setDetailWidth,
    toggleNavigation,
    closeNavigationDrawer,
  };
}

function setPaneWidth(
  setPreferences: Dispatch<SetStateAction<PanePreferences>>,
  key: 'navigationWidth' | 'collectionWidth' | 'detailWidth',
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

function readPreferences(): PanePreferences {
  const defaults: PanePreferences = {
    navigationWidth: PANE_LIMITS.navigation.defaultValue,
    collectionWidth: PANE_LIMITS.collection.defaultValue,
    detailWidth: PANE_LIMITS.detail.defaultValue,
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
      detailWidth: constrain(
        stored.detailWidth,
        PANE_LIMITS.detail,
        defaults.detailWidth,
      ),
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
