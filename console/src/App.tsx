import { useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { api, getToken } from "./api";
import ApplicationPage from "./pages/Application";
import InboxPage from "./pages/Inbox";
import InsightsPage from "./pages/Insights";
import JobPage from "./pages/Job";
import JobsPage from "./pages/Jobs";
import HomePage from "./pages/Home";
import MorePage from "./pages/More";
import PipelinePage from "./pages/Pipeline";
import ProfilePage from "./pages/Profile";
import SettingsPage from "./pages/Settings";
import SourcesPage from "./pages/Sources";
import { Button, Field, NoticeProvider } from "./ui";

const icons: Record<string, ReactNode> = {
  home: <path d="M3 11l9-8 9 8v9H3zM9 20v-6h6v6" />,
  jobs: <path d="M4 7h16v12H4zM9 7V5h6v2" />,
  pipeline: <path d="M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v6h-4z" />,
  inbox: <path d="M4 13l2-8h12l2 8v6H4zM4 13h5l1 2h4l1-2h5" />,
  profile: <path d="M12 12a4 4 0 100-8 4 4 0 000 8zM5 20c1-4 4-6 7-6s6 2 7 6" />,
  sources: <path d="M5 5h14v4H5zM5 11h14v4H5zM5 17h8" />,
  insights: <path d="M5 19V9M10 19V5M15 19v-7M20 19v-4" />,
  settings: <path d="M12 15a3 3 0 100-6 3 3 0 000 6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
};

function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      {icons[name]}
    </svg>
  );
}

function useCounts() {
  const [counts, setCounts] = useState({ inbox: 0, attention: 0 });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [inbox, queue] = await Promise.all([api.inboxStatus(), api.queue()]);
        if (alive) setCounts({ inbox: inbox.unresolved, attention: queue.length });
      } catch {
        // counts are decoration; pages report their own errors
      }
    };
    void load();
    const timer = window.setInterval(load, 60_000);
    window.addEventListener("jobcopilot:changed", load);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("jobcopilot:changed", load);
    };
  }, []);
  return counts;
}

function Shell() {
  const counts = useCounts();
  const main = [
    { to: "/", label: "Home", icon: "home" },
    { to: "/jobs", label: "Jobs", icon: "jobs" },
    { to: "/applications", label: "Pipeline", icon: "pipeline", count: counts.attention, countLabel: "need attention" },
    { to: "/inbox", label: "Inbox", icon: "inbox", count: counts.inbox, countLabel: "to sort" },
    { to: "/profile", label: "Profile", icon: "profile" },
  ];
  const extra = [
    { to: "/sources", label: "Job boards", icon: "sources" },
    { to: "/insights", label: "Insights", icon: "insights" },
    { to: "/settings", label: "Settings", icon: "settings" },
  ];
  const link = (item: { to: string; label: string; icon: string; count?: number; countLabel?: string }) => (
    <NavLink key={item.to} to={item.to} className="nav-link">
      <Icon name={item.icon} />
      <span className="nav-label">{item.label}</span>
      {item.count ? (
        <span className="nav-count" aria-label={`${item.count} ${item.countLabel}`}>
          {item.count}
        </span>
      ) : null}
    </NavLink>
  );

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M6 12.5l4 4 8-9" />
            </svg>
          </span>
          job-copilot
        </div>
        {main.map(link)}
        <div className="nav-sep" />
        {extra.map(link)}
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/:id" element={<JobPage />} />
          <Route path="/applications" element={<PipelinePage />} />
          <Route path="/applications/:id" element={<ApplicationPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/sources" element={<SourcesPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/more" element={<MorePage />} />
          <Route path="*" element={<Navigate to="/jobs" replace />} />
        </Routes>
      </main>
      <nav className="tabbar" aria-label="Main">
        {main.map(link)}
        {link({ to: "/more", label: "More", icon: "more" })}
      </nav>
    </div>
  );
}

function SignIn() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") await api.register(email.trim(), password);
      else await api.login(email.trim(), password);
      window.dispatchEvent(new Event("jobcopilot:auth"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cannot reach the API. Is it running?");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <form className="card signin-card" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9" /></svg>
          </span>
          job-copilot
        </div>
        <h1>{mode === "login" ? "Welcome back" : "Create your account"}</h1>
        <p className="subtle">
          {mode === "login" ? "Sign in to manage your profile, jobs, and applications." : "Create an account to keep your job-search data private to you."}
        </p>
        <Field label="Email">
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        </Field>
        <Field label="Password" hint={mode === "register" ? "Use at least 8 characters." : undefined}>
          <input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </Field>
        {error && <p className="form-error">{error}</p>}
        <Button variant="primary" busy={busy} type="submit">{mode === "login" ? "Sign in" : "Create account"}</Button>
        <button className="link-btn auth-switch" type="button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [signedIn, setSignedIn] = useState(() => Boolean(getToken()));
  useEffect(() => {
    let alive = true;
    if (!getToken()) void api.me().then(() => alive && setSignedIn(true)).catch(() => alive && setSignedIn(false));
    const onAuth = () => {
      if (getToken()) setSignedIn(true);
      else void api.me().then(() => alive && setSignedIn(true)).catch(() => alive && setSignedIn(false));
    };
    window.addEventListener("jobcopilot:auth", onAuth);
    return () => {
      alive = false;
      window.removeEventListener("jobcopilot:auth", onAuth);
    };
  }, []);

  return (
    <NoticeProvider>
      <BrowserRouter>{signedIn ? <Shell /> : <SignIn />}</BrowserRouter>
    </NoticeProvider>
  );
}
