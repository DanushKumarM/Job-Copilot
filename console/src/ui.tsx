import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiError } from "./api";

// --- data loading --------------------------------------------------------------------------------

export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const counter = useRef(0);

  const reload = useCallback(async () => {
    const id = ++counter.current;
    setLoading(true);
    try {
      const value = await load();
      if (id === counter.current) {
        setData(value);
        setError(null);
      }
    } catch (e) {
      if (id === counter.current) setError(e as Error);
    } finally {
      if (id === counter.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

// --- notices -------------------------------------------------------------------------------------

interface Notice {
  id: number;
  tone: "ok" | "error";
  title: string;
  details?: string[];
}

const NoticeContext = createContext<{
  ok: (title: string) => void;
  fail: (error: unknown) => void;
}>({ ok: () => {}, fail: () => {} });

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const next = useRef(0);

  const push = useCallback((n: Omit<Notice, "id">) => {
    const id = ++next.current;
    setNotices((all) => [...all.slice(-3), { ...n, id }]);
    window.setTimeout(() => setNotices((all) => all.filter((x) => x.id !== id)), n.tone === "ok" ? 3500 : 9000);
  }, []);

  const ok = useCallback((title: string) => push({ tone: "ok", title }), [push]);
  const fail = useCallback(
    (error: unknown) => {
      const e = error as Error;
      push({ tone: "error", title: e.message || "Something went wrong", details: e instanceof ApiError ? e.issues : [] });
    },
    [push],
  );

  return (
    <NoticeContext.Provider value={{ ok, fail }}>
      {children}
      <div className="notices" role="status" aria-live="polite">
        {notices.map((n) => (
          <div key={n.id} className={`notice notice-${n.tone}`}>
            <strong>{n.title}</strong>
            {n.details && n.details.length > 0 && (
              <ul>
                {n.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
            <button
              className="notice-close"
              aria-label="Dismiss"
              onClick={() => setNotices((all) => all.filter((x) => x.id !== n.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </NoticeContext.Provider>
  );
}

export const useNotice = () => useContext(NoticeContext);

/** Run an action with a busy flag; report failures as a notice. Returns the result or undefined. */
export function useAction() {
  const notice = useNotice();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, action: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(key);
      try {
        const result = await action();
        if (success) notice.ok(success);
        return result;
      } catch (e) {
        notice.fail(e);
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [notice],
  );
  return { busy, run };
}

// --- statuses ------------------------------------------------------------------------------------

type Tone = "neutral" | "muted" | "info" | "warn" | "ok" | "bad" | "accent";

export const STATUS: Record<string, { label: string; tone: Tone }> = {
  discovered: { label: "New", tone: "neutral" },
  rejected_by_rules: { label: "Filtered out", tone: "muted" },
  shortlisted: { label: "Shortlisted", tone: "info" },
  prepared: { label: "Drafted", tone: "info" },
  awaiting_approval: { label: "Needs review", tone: "warn" },
  approved: { label: "Approved", tone: "ok" },
  submission_in_progress: { label: "Applying", tone: "info" },
  submitted_unconfirmed: { label: "Submitted, unconfirmed", tone: "warn" },
  submission_confirmed: { label: "Confirmed", tone: "ok" },
  assessment: { label: "Assessment", tone: "accent" },
  interview: { label: "Interview", tone: "accent" },
  offer: { label: "Offer", tone: "ok" },
  rejected: { label: "Rejected", tone: "bad" },
  withdrawn: { label: "Withdrawn", tone: "muted" },
  failed: { label: "Failed", tone: "bad" },
  needs_manual_intervention: { label: "Needs attention", tone: "warn" },
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const s = STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <span className={`badge badge-${s.tone}`}>{s.label}</span>;
}

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Score({ value, size = 44 }: { value: number | null | undefined; size?: number }) {
  if (value === null || value === undefined) {
    return (
      <div className="score score-none" style={{ width: size, height: size }} title="Not scored yet">
        –
      </div>
    );
  }
  const tone = value >= 70 ? "ok" : value >= 50 ? "warn" : "bad";
  const r = 15.5;
  const c = 2 * Math.PI * r;
  return (
    <div className={`score score-${tone}`} style={{ width: size, height: size }} title={`Fit score ${value} of 100`}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r={r} className="score-track" />
        <circle
          cx="18"
          cy="18"
          r={r}
          className="score-arc"
          strokeDasharray={`${(c * value) / 100} ${c}`}
          transform="rotate(-90 18 18)"
        />
      </svg>
      <span>{value}</span>
    </div>
  );
}

// --- layout pieces -------------------------------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <header className="page-header">
      {back}
      <div className="page-header-row">
        <div className="page-header-text">
          <h1>{title}</h1>
          {subtitle && <p className="subtle">{subtitle}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </header>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" /> {label}…
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <strong>{error.message}</strong>
      {error instanceof ApiError && error.issues.length > 0 && (
        <ul>
          {error.issues.map((i, n) => (
            <li key={n}>{i}</li>
          ))}
        </ul>
      )}
      {retry && (
        <button className="btn btn-small" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <div className="subtle">{children}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function Button({
  busy,
  variant = "default",
  small,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  variant?: "default" | "primary" | "danger" | "ghost";
  small?: boolean;
}) {
  return (
    <button
      {...rest}
      className={`btn btn-${variant}${small ? " btn-small" : ""} ${rest.className ?? ""}`}
      disabled={busy || rest.disabled}
      aria-busy={busy || undefined}
    >
      {busy && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

// --- formatting ----------------------------------------------------------------------------------

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return "just now";
  const units: [number, string][] = [
    [60, "minute"],
    [3600, "hour"],
    [86400, "day"],
    [604800, "week"],
    [2629800, "month"],
  ];
  let label = "";
  for (const [size, name] of units) {
    if (seconds >= size) {
      const n = Math.floor(seconds / size);
      label = `${n} ${name}${n === 1 ? "" : "s"} ago`;
    }
  }
  return label;
}

export function date(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const WORK_MODES: Record<string, string> = {
  onsite: "On-site",
  hybrid: "Hybrid",
  remote: "Remote",
  unknown: "Work mode unknown",
};

/** Pages call this after a change that affects the nav counts (inbox, manual queue). */
export function announceChange() {
  window.dispatchEvent(new Event("jobcopilot:changed"));
}
