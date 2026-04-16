import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';

interface HostMountsContextValue {
  // Returns the real host path for a given container path, or the original if unknown
  resolveHostPath: (containerPath: string) => string;
  // Returns the basename of the real host path (e.g. "notion-agent-hive" instead of "code")
  resolveHostName: (containerPath: string) => string;
}

const HostMountsContext = createContext<HostMountsContextValue>({
  resolveHostPath: (p) => p,
  resolveHostName: (p) => p.split('/').pop() ?? p,
});

export function HostMountsProvider({ children }: { children: ReactNode }) {
  const [mounts, setMounts] = useState<Record<string, string>>({});

  useEffect(() => {
    api.getHostMounts().then(setMounts);
  }, []);

  function resolveHostPath(containerPath: string): string {
    let bestLen = 0;
    let result = containerPath;
    for (const [cMount, hMount] of Object.entries(mounts)) {
      if (containerPath.startsWith(cMount) && cMount.length > bestLen) {
        bestLen = cMount.length;
        result = hMount + containerPath.slice(cMount.length);
      }
    }
    return result;
  }

  function resolveHostName(containerPath: string): string {
    return resolveHostPath(containerPath).split('/').pop() ?? containerPath;
  }

  return (
    <HostMountsContext.Provider value={{ resolveHostPath, resolveHostName }}>
      {children}
    </HostMountsContext.Provider>
  );
}

export function useHostMounts() {
  return useContext(HostMountsContext);
}
