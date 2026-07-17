import { useCallback, useState } from 'react';

// Persists the chosen stock venue scope across reloads and across every Stock
// page (Items, Reorder, Wastage, Staff usage) under one suite-wide key, so a
// manager who scopes to a venue doesn't get bounced back to "all venues" on
// every navigation or refresh. Pages still adopt the server's default scope
// when nothing has been chosen yet (the stored value starts empty).
const STORAGE_KEY = 'alma-stock-venue';

function readStored(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function useStickyVenue(): [string, (venue: string) => void] {
  const [venue, setVenueState] = useState<string>(readStored);

  const setVenue = useCallback((next: string) => {
    setVenueState(next);
    try {
      if (next) {
        window.localStorage.setItem(STORAGE_KEY, next);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Storage unavailable (private mode / quota) — scope just won't persist.
    }
  }, []);

  return [venue, setVenue];
}
