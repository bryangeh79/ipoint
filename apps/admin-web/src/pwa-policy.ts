import { useEffect, useState } from 'react';

export interface AdminWriteEnvironment {
  online: boolean;
  desktop: boolean;
  standalone: boolean;
}

/** Privileged and sensitive writes require the full online desktop web flow. */
export function canPerformSensitiveAdminWrite(
  environment: AdminWriteEnvironment,
): boolean {
  return environment.online && environment.desktop && !environment.standalone;
}

export function useAdminWriteEnvironment(): AdminWriteEnvironment {
  const [environment, setEnvironment] = useState(readEnvironment);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px) and (pointer: fine)');
    const standalone = window.matchMedia('(display-mode: standalone)');
    const update = () => setEnvironment(readEnvironment());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    media.addEventListener('change', update);
    standalone.addEventListener('change', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      media.removeEventListener('change', update);
      standalone.removeEventListener('change', update);
    };
  }, []);
  return environment;
}

function readEnvironment(): AdminWriteEnvironment {
  return {
    online: navigator.onLine,
    desktop: window.matchMedia('(min-width: 768px) and (pointer: fine)')
      .matches,
    standalone: window.matchMedia('(display-mode: standalone)').matches,
  };
}
