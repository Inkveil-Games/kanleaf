import { useCallback, useEffect, useState, type SetStateAction } from 'react';

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

export function useWorkspacePaneLayout() {
  const [preferences, setPreferences] = useState(readPreferences);
  const narrow = useMediaQuery(NARROW_QUERY);
  const [drawer, setDrawer] = useState({ narrow, open: false });

  useEffect(() => {
    writePreferences(preferences);
  }, [preferences]);

  const drawerOpen = drawer.narrow === narrow && drawer.open;
  const navigationVisible = narrow
    ? drawerOpen
    : !preferences.navigationCollapsed;
  const closeNavigationDrawer = useCallback(
    () =>
      setDrawer((current) =>
        current.open ? { ...current, open: false } : current,
      ),
    [],
  );

  function updateWidth(
    key: 'navigationWidth' | 'collectionWidth' | 'detailWidth',
    limits: PaneLimits,
  ) {
    return (next: SetStateAction<number>) => {
      setPreferences((current) => ({
        ...current,
        [key]: constrain(
          typeof next === 'function' ? next(current[key]) : next,
          limits,
        ),
      }));
    };
  }

  return {
    ...preferences,
    narrow,
    navigationVisible,
    setNavigationWidth: updateWidth('navigationWidth', PANE_LIMITS.navigation),
    setCollectionWidth: updateWidth('collectionWidth', PANE_LIMITS.collection),
    setDetailWidth: updateWidth('detailWidth', PANE_LIMITS.detail),
    toggleNavigation() {
      if (narrow) {
        setDrawer({ narrow, open: !drawerOpen });
      } else {
        setPreferences((current) => ({
          ...current,
          navigationCollapsed: !current.navigationCollapsed,
        }));
      }
    },
    closeNavigationDrawer,
  };
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof matchMedia === 'function' ? matchMedia(query).matches : false,
  );

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia(query);
    const changed = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, [query]);

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
