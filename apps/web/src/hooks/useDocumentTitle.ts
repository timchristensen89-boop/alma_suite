import { useEffect } from 'react';

const BASE_TITLE = 'ALMA Suites · Compliance';

/**
 * Update the document title for the current page.
 *
 * Pass a section label (e.g. "Issues") and it renders as
 * "Issues · ALMA Suites".  Pass null to fall back to the base title.
 * On unmount the previous title is restored so nothing leaks between
 * client-side navigations.
 */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    const prev = document.title;
    document.title = title ? `${title} · ALMA Suites` : BASE_TITLE;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
