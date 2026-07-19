import { useEffect, useRef } from 'react';

/**
 * Returns a stable AbortController that is aborted on unmount.
 * Useful for cancelling in-flight requests when a component unmounts.
 */
export function useAbortController(): AbortController {
  const controllerRef = useRef<AbortController | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = new AbortController();
  }

  useEffect(() => {
    const controller = controllerRef.current;
    return () => {
      controller.abort();
      controllerRef.current = null;
    };
  }, []);

  return controllerRef.current;
}
