import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
}
interface ToastApi {
  notify(message: string): void;
  error(error: unknown): void;
}

const ToastContext = createContext<ToastApi>({ notify: () => {}, error: () => {} });
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, kind: Toast['kind']) => {
    const id = ++seq;
    setToasts((t) => [...t, { id, message, kind }]);
    // Los errores permanecen hasta que se cierran: 5 s no bastan para leerlos y actuar.
    if (kind !== 'error') setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  const api: ToastApi = {
    notify: (m) => push(m, 'info'),
    error: (e) => push(e instanceof Error ? e.message : 'Ha ocurrido un error', 'error'),
  };
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.kind === 'error' ? ' toast--error' : ''}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span>{t.message}</span>
            <button className="toast__close" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} aria-label="Cerrar aviso">
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
