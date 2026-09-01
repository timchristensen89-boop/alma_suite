import { useCallback, useEffect, useState } from 'react';

/**
 * Load data, with a distinction that matters more than it looks:
 *
 *   loading    — there is nothing on screen yet. Show a spinner.
 *   refreshing — there IS something on screen and we are re-fetching it.
 *                Leave it up.
 *
 * Without that split, `reload()` flipped `loading` back to true, and every
 * page whose first line is `if (loading) return <Spinner/>` unmounted its
 * whole body for one frame. The page collapsed to the height of a spinner,
 * the browser clamped the scroll position to the top, and the list came back
 * a moment later with the reader now at the top of it.
 *
 * On a checklist that reloads after every Pass/Fail, that is a jump to the
 * top of the page on every single tap — twenty items in, you scroll back down
 * twenty times. Same on audits, issues and temperatures, which reload the
 * same way.
 *
 * A deps change is NOT a refresh: it means a different record, so the loader
 * clears what is on screen and shows the spinner. Only the caller-facing
 * `reload` keeps the current data up.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (keepData = false) => {
    try {
      if (keepData) {
        setRefreshing(true);
      } else {
        setLoading(true);
        // Deps changed, so `data` belongs to the record we are navigating
        // away from. Holding it would show one run's items under another
        // run's heading — on a Pass/Fail screen, long enough to tap.
        setData(null);
      }
      setError(null);
      const result = await loader();
      setData(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, deps);

  useEffect(() => {
    void run();
  }, [run]);

  const reload = useCallback(() => run(true), [run]);

  return { data, loading, refreshing, error, reload };
}
