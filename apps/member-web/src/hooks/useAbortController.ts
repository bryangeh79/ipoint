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
      controller?.abort();
      controllerRef.current = null;
    };
  }, []);

  // controllerRef.current is guaranteed non-null at this point
  // because the if-block above initializes it on first call
  return controllerRef.current!;
}
