import { useEffect } from 'react';

const BASE_TITLE = 'ALMA Suites · Stock';

/**
 * Update the document title for the current stock page. Matches the
 * compliance app's hook so pages can share the same pattern.
 */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} · ALMA Suites Stock` : BASE_TITLE;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
