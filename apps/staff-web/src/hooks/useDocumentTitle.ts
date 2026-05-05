import { useEffect } from 'react';

const DEFAULT_TITLE = 'ALMA Staff';

export function useDocumentTitle(title?: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} · ALMA Staff` : DEFAULT_TITLE;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
