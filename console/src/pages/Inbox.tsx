import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type AppSummary, type InboxMessage, type MessageClass } from "../api";
import {
  Badge,
  Button,
  Empty,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  StatusBadge,
  ago,
  announceChange,
  date,
  useAction,
  useLoad,
} from "../ui";

const CLASSES: Record<string, { label: string; tone: "ok" | "bad" | "accent" | "info" | "muted" }> = {
  confirmation: { label: "Confirmation", tone: "ok" },
  rejection: { label: "Rejection", tone: "bad" },
  assessment: { label: "Assessment", tone: "accent" },
  interview: { label: "Interview", tone: "accent" },
  offer: { label: "Offer", tone: "ok" },
  job_alert: { label: "Job alert", tone: "info" },
  other: { label: "Other", tone: "muted" },
};

export default function InboxPage() {
  const status = useLoad(api.inboxStatus);
  const messages = useLoad(api.inbox);
  const apps = useLoad(() => api.applications());
  const { busy, run } = useAction();
  const [assigning, setAssigning] = useState<InboxMessage | null>(null);
  const [importing, setImporting] = useState<InboxMessage | null>(null);

  const appById = useMemo(() => new Map((apps.data ?? []).map((a) => [a.id, a])), [apps.data]);
  const refresh = async () => {
    await Promise.all([messages.reload(), status.reload(), apps.reload()]);
    announceChange();
  };

  const s = status.data;
  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle="Emails the worker could not place with confidence. Nothing here changes an application until you decide."
        actions={
          <Button
            busy={busy === "sync"}
            disabled={!s?.gmail_connected}
            onClick={() => run("sync", api.syncInbox, "Sync queued; the worker picks it up within seconds")}
          >
            Sync now
          </Button>
        }
      />

      {s && (
        <section className={`card inbox-status${s.gmail_connected ? "" : " next-warn"}`}>
          {s.gmail_connected ? (
            <p>
              <Badge tone="ok">Gmail connected</Badge> <span className="subtle">read-only · last synced {ago(s.last_synced_at)}</span>
            </p>
          ) : (
            <>
              <p>
                <Badge tone="warn">Gmail not connected</Badge>
              </p>
              <p className="small">
                Job alerts, confirmations and outcomes come from your inbox. Connect it once from a terminal:{" "}
                <code>backend\.venv\Scripts\jobcopilot gmail-auth</code> (setup steps are in the README). The worker
                (<code>jobcopilot worker</code>) then syncs every 15 minutes.
              </p>
            </>
          )}
        </section>
      )}

      {messages.error && <ErrorBox error={messages.error} retry={messages.reload} />}
      {messages.loading && !messages.data && <Loading />}
      {messages.data && messages.data.length === 0 && (
        <Empty title="Nothing to sort">Every processed email has been placed or dismissed.</Empty>
      )}
      <ul className="message-list">
        {(messages.data ?? []).map((m) => {
          const cls = CLASSES[m.classification] ?? CLASSES.other;
          const guess = m.application_id ? appById.get(m.application_id) : undefined;
          const x = m.extracted as Record<string, string | undefined>;
          return (
            <li key={m.id} className="card message">
              <div className="message-head">
                <Badge tone={cls.tone}>{cls.label}</Badge>
                <span className="subtle small">{Math.round(m.confidence * 100)}% sure</span>
                <span className="subtle small message-date">{date(x.received_at ?? m.processed_at)}</span>
              </div>
              <div className="message-subject">{x.subject ?? "(no subject)"}</div>
              <div className="subtle small">{x.from}</div>
              {guess && (
                <p className="small">
                  Best guess:{" "}
                  <Link to={`/applications/${guess.id}`}>
                    {guess.job_title} at {guess.company}
                  </Link>{" "}
                  <StatusBadge status={guess.status} />
                </p>
              )}
              {x.match_reason && <p className="subtle small">{x.match_reason}</p>}
              <div className="action-row">
                <Button small variant="primary" onClick={() => setAssigning(m)}>
                  Assign to application
                </Button>
                <Button small onClick={() => setImporting(m)} title="An application you made outside job-copilot">
                  Track as new application
                </Button>
                <Button
                  small
                  variant="ghost"
                  busy={busy === `dismiss-${m.id}`}
                  onClick={async () => {
                    if (await run(`dismiss-${m.id}`, () => api.dismiss(m.id), "Dismissed")) await refresh();
                  }}
                >
                  Dismiss
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {assigning && (
        <AssignDialog
          message={assigning}
          apps={apps.data ?? []}
          onClose={() => setAssigning(null)}
          onDone={async () => {
            setAssigning(null);
            await refresh();
          }}
        />
      )}
      {importing && (
        <ImportDialog
          message={importing}
          onClose={() => setImporting(null)}
          onDone={async () => {
            setImporting(null);
            await refresh();
          }}
        />
      )}
    </>
  );
}

function AssignDialog({
  message,
  apps,
  onClose,
  onDone,
}: {
  message: InboxMessage;
  apps: AppSummary[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [search, setSearch] = useState("");
  const [appId, setAppId] = useState(message.application_id ?? "");
  const [cls, setCls] = useState<MessageClass>(message.classification as MessageClass);
  const { busy, run } = useAction();
  const candidates = apps
    .filter((a) => !["discovered", "rejected_by_rules"].includes(a.status))
    .filter((a) => `${a.job_title} ${a.company}`.toLowerCase().includes(search.toLowerCase()));

  const submit = async () => {
    const changed = cls !== message.classification ? cls : undefined;
    if (await run("assign", () => api.assign(message.id, appId, changed), "Assigned")) onDone();
  };

  return (
    <Modal
      title="Assign email"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy === "assign"} disabled={!appId} onClick={submit}>
            Assign
          </Button>
        </>
      }
    >
      <p className="small">
        <strong>{(message.extracted as Record<string, string>).subject}</strong>
      </p>
      <Field label="This email is a">
        <select value={cls} onChange={(e) => setCls(e.target.value as MessageClass)}>
          {Object.entries(CLASSES)
            .filter(([k]) => k !== "job_alert")
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
        </select>
      </Field>
      <Field label="About the application">
        <input type="search" placeholder="Filter by role or company" value={search} onChange={(e) => setSearch(e.target.value)} />
      </Field>
      <div className="pick-list" role="listbox" aria-label="Applications">
        {candidates.length === 0 && <p className="subtle small">No applications match.</p>}
        {candidates.map((a) => (
          <label key={a.id} className={`pick${appId === a.id ? " picked" : ""}`}>
            <input type="radio" name="app" checked={appId === a.id} onChange={() => setAppId(a.id)} />
            <span>
              {a.job_title} <span className="subtle">at {a.company}</span>
            </span>
            <StatusBadge status={a.status} />
          </label>
        ))}
      </div>
    </Modal>
  );
}

function ImportDialog({ message, onClose, onDone }: { message: InboxMessage; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ company: "", title: "", location: "" });
  const { busy, run } = useAction();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { company: form.company, title: form.title, location: form.location || undefined };
    if (await run("import", () => api.importMessage(message.id, body), "Now tracking this application")) onDone();
  };
  return (
    <Modal
      title="Track an application made elsewhere"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy === "import"} type="submit" form="import-form">
            Track it
          </Button>
        </>
      }
    >
      <p className="small">
        For applications made on Naukri, LinkedIn Easy Apply or a careers page. The email becomes the evidence:{" "}
        <strong>{(message.extracted as Record<string, string>).subject}</strong>
      </p>
      <form id="import-form" className="form-grid" onSubmit={submit}>
        <Field label="Company">
          <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} required />
        </Field>
        <Field label="Role">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        </Field>
        <Field label="Location (optional)">
          <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </Field>
      </form>
    </Modal>
  );
}
