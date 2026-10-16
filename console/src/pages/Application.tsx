import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ApiError,
  api,
  type AppDetail,
  type AppStatus,
  type ClaimDraft,
  type DocumentKind,
  type DocumentOut,
  type Fact,
} from "../api";
import {
  Badge,
  Button,
  Empty,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  STATUS,
  Score,
  StatusBadge,
  announceChange,
  date,
  saveBlob,
  useAction,
  useLoad,
} from "../ui";

const KINDS: { kind: DocumentKind; label: string; hint: string }[] = [
  { kind: "resume_bullets", label: "Resume bullets", hint: "4-8 bullets tailored to this job" },
  { kind: "summary", label: "Summary", hint: "2-3 sentences for the top of the resume" },
  { kind: "screening_answers", label: "Screening answers", hint: "Answers to the form's questions" },
  { kind: "cover_letter", label: "Cover letter", hint: "Optional" },
];

// Moves the user makes by hand. Approval, confirmation and form-filling have their own paths.
const ACTIONS: Partial<Record<AppStatus, { label: string; danger?: boolean; outcome?: boolean }>> = {
  submitted_unconfirmed: { label: "I submitted it myself" },
  assessment: { label: "Record assessment", outcome: true },
  interview: { label: "Record interview", outcome: true },
  offer: { label: "Record offer", outcome: true },
  rejected: { label: "Record rejection", outcome: true, danger: true },
  approved: { label: "Back to approved" },
  awaiting_approval: { label: "Back to review" },
  shortlisted: { label: "Back to shortlist" },
  withdrawn: { label: "Withdraw", danger: true },
};
const CONFIRMED = ["submission_confirmed", "assessment", "interview"];

export default function ApplicationPage() {
  const { id = "" } = useParams();
  const app = useLoad(() => api.application(id), [id]);
  const facts = useLoad(() => api.facts(), []);
  const { busy, run } = useAction();
  const [pending, setPending] = useState<AppStatus | null>(null);

  if (app.error) return <ErrorBox error={app.error} retry={app.reload} />;
  if (!app.data) return <Loading />;
  const a = app.data;

  const refresh = async () => {
    await app.reload();
    announceChange();
  };
  const download = async (kind: "resume" | "answers") => {
    const file = await run(`pdf-${kind}`, () => api.pdf(a.id, kind));
    if (file) saveBlob(file.blob, file.filename);
  };
  const approve = async () => {
    if (await run("approve", () => api.approve(a.id, a.lock_version), "Approved. The packet is ready for the extension.")) await refresh();
  };

  const actions = (a.allowed_targets as AppStatus[]).filter(
    (t) => ACTIONS[t] && (!ACTIONS[t]!.outcome || CONFIRMED.includes(a.status)) && !(t === "approved" && a.status === "awaiting_approval"),
  );

  return (
    <>
      <PageHeader
        back={
          <Link to="/applications" className="back">
            ← Pipeline
          </Link>
        }
        title={a.job_title}
        subtitle={
          <>
            {a.company} · <StatusBadge status={a.status} />
            {a.confirmed_at && <span className="subtle"> · confirmed {date(a.confirmed_at)}</span>}
          </>
        }
        actions={
          <>
            <Link className="btn btn-ghost" to={`/jobs/${a.job_id}`}>
              Job and fit
            </Link>
            {a.job_url && (
              <a className="btn btn-ghost" href={a.job_url} target="_blank" rel="noreferrer">
                Posting ↗
              </a>
            )}
          </>
        }
      />

      <NextStep app={a} busy={busy} onApprove={approve} onDownload={download} onAction={setPending} />

      <Documents app={a} facts={facts.data ?? []} onChange={refresh} />

      <div className="grid-2">
        <section className="card">
          <h2>Evidence</h2>
          <p className="subtle">Confirmation pages, emails and submission attempts. Each one is recorded once.</p>
          {a.evidence.length === 0 ? (
            <p className="subtle">None yet.</p>
          ) : (
            <ul className="plain-list">
              {a.evidence.map((e) => (
                <li key={e.id} className="evidence">
                  <Badge tone={e.kind.includes("rejection") ? "bad" : e.kind === "submission_attempt" ? "neutral" : "ok"}>
                    {e.kind.replaceAll("_", " ")}
                  </Badge>
                  <div className="small">
                    {(e.extracted?.subject as string) ?? (e.extracted?.url as string) ?? e.external_ref}
                    <div className="subtle">
                      {date(e.created_at)}
                      {e.confidence < 1 && ` · ${Math.round(e.confidence * 100)}% confident`}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {actions.length > 0 && (
            <div className="action-row">
              {actions.map((t) => (
                <Button key={t} small variant={ACTIONS[t]!.danger ? "danger" : "default"} onClick={() => setPending(t)}>
                  {ACTIONS[t]!.label}
                </Button>
              ))}
            </div>
          )}
        </section>
        <section className="card">
          <h2>History</h2>
          <ol className="timeline">
            {[...a.history].reverse().map((e, i) => (
              <li key={i}>
                <div>
                  {e.from_status === e.to_status ? (
                    <span>Evidence attached</span>
                  ) : (
                    <>
                      <StatusBadge status={e.to_status} />
                    </>
                  )}
                  <span className="subtle small"> by {e.actor}</span>
                </div>
                {e.note && <div className="small">{e.note}</div>}
                <div className="subtle small">{date(e.created_at)}</div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {pending && (
        <TransitionDialog
          app={a}
          target={pending}
          onClose={() => setPending(null)}
          onDone={async () => {
            setPending(null);
            await refresh();
          }}
        />
      )}
    </>
  );
}

function NextStep({
  app,
  busy,
  onApprove,
  onDownload,
  onAction,
}: {
  app: AppDetail;
  busy: string | null;
  onApprove: () => void;
  onDownload: (kind: "resume" | "answers") => void;
  onAction: (t: AppStatus) => void;
}) {
  const s = app.status;
  const lastNote = [...app.history].reverse().find((e) => e.note)?.note;
  const pdfs = (
    <>
      <Button busy={busy === "pdf-resume"} onClick={() => onDownload("resume")}>
        Resume PDF
      </Button>
      <Button busy={busy === "pdf-answers"} onClick={() => onDownload("answers")}>
        Answers sheet PDF
      </Button>
    </>
  );

  let body: React.ReactNode = null;
  if (s === "shortlisted" || s === "prepared") {
    body = <p>Generate resume bullets (and a summary if you like) below. Every claim must cite a verified fact.</p>;
  } else if (s === "awaiting_approval") {
    body = (
      <>
        <p>Read every claim below. Approval re-checks each citation against your current facts.</p>
        <div className="action-row">
          <Button variant="primary" busy={busy === "approve"} onClick={onApprove}>
            Approve
          </Button>
        </div>
      </>
    );
  } else if (s === "approved" || s === "submission_in_progress") {
    body = (
      <>
        <p>
          Open the posting and click <strong>Fill</strong> in the job-copilot extension (Greenhouse and Lever). Review the
          form and press Submit yourself. Elsewhere, use the PDFs and mark it submitted.
        </p>
        <div className="action-row">
          {pdfs}
          {s === "approved" && (
            <Button variant="primary" onClick={() => onAction("submitted_unconfirmed")}>
              I submitted it myself
            </Button>
          )}
          {s === "submission_in_progress" && <Button onClick={() => onAction("approved")}>I abandoned the form</Button>}
        </div>
      </>
    );
  } else if (s === "submitted_unconfirmed") {
    body = (
      <>
        <p>Waiting for proof: a confirmation page captured by the extension, or a “thanks for applying” email.</p>
        <div className="action-row">{pdfs}</div>
      </>
    );
  } else if (CONFIRMED.includes(s)) {
    body = <p>The employer has it. Outcomes arrive from your inbox; you can also record one below.</p>;
  } else if (s === "needs_manual_intervention") {
    body = (
      <>
        <p>This needs a decision from you{lastNote ? ":" : "."}</p>
        {lastNote && <blockquote className="note">{lastNote}</blockquote>}
        <p className="subtle small">
          If an email was matched to the wrong application, fix it from the <Link to="/inbox">Inbox</Link>. If generation
          failed, edit the content by hand below or go back to the shortlist.
        </p>
      </>
    );
  } else if (s === "failed") {
    body = <p>{lastNote ?? "Something failed."}</p>;
  }
  if (!body) return null;
  return (
    <section className={`card next-step next-${STATUS[s]?.tone ?? "neutral"}`}>
      <div className="next-head">
        <h2>Next step</h2>
        {app.score !== null && app.score !== undefined && <Score value={app.score} size={36} />}
      </div>
      {body}
    </section>
  );
}

function TransitionDialog({
  app,
  target,
  onClose,
  onDone,
}: {
  app: AppDetail;
  target: AppStatus;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const { busy, run } = useAction();
  const label = ACTIONS[target]?.label ?? STATUS[target]?.label ?? target;
  const submit = async () => {
    const ok = await run("go", () => api.transition(app.id, target, app.lock_version, note || undefined), "Updated");
    if (ok) onDone();
  };
  return (
    <Modal
      title={label}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={ACTIONS[target]?.danger ? "danger" : "primary"} busy={busy === "go"} onClick={submit}>
            {label}
          </Button>
        </>
      }
    >
      <p>
        Moves <strong>{app.job_title}</strong> from <StatusBadge status={app.status} /> to <StatusBadge status={target} />
        . This is recorded in the history with you as the actor
        {ACTIONS[target]?.outcome ? ", without email evidence" : ""}.
      </p>
      <Field label="Note (optional)">
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

// --- documents -----------------------------------------------------------------------------------

function Documents({ app, facts, onChange }: { app: AppDetail; facts: Fact[]; onChange: () => Promise<void> }) {
  const [kind, setKind] = useState<DocumentKind>("resume_bullets");
  const versions = app.documents.filter((d) => d.kind === kind).sort((x, y) => y.doc_version - x.doc_version);
  const [picked, setPicked] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const { busy, run } = useAction();
  const factById = useMemo(() => new Map(facts.map((f) => [f.id, f])), [facts]);

  const doc = versions.find((d) => d.doc_version === picked) ?? versions[0];
  const locked = ["submission_in_progress", "submitted_unconfirmed", "submission_confirmed", "assessment", "interview", "offer", "rejected", "withdrawn"].includes(app.status);

  const generate = async () => {
    await run("generate", () => api.generate(app.id, kind), "Drafted and validated: every claim cites a verified fact");
    setPicked(null);
    // Reload either way: a generation that keeps failing validation moves the application to the manual queue.
    await onChange();
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Application content</h2>
      </div>
      <div className="tabs" role="tablist">
        {KINDS.map((k) => {
          const count = app.documents.filter((d) => d.kind === k.kind).length;
          return (
            <button
              key={k.kind}
              role="tab"
              aria-selected={kind === k.kind}
              className={kind === k.kind ? "active" : ""}
              onClick={() => {
                setKind(k.kind);
                setPicked(null);
                setEditing(false);
              }}
            >
              {k.label}
              {count > 0 && <span className="seg-count">v{Math.max(...app.documents.filter((d) => d.kind === k.kind).map((d) => d.doc_version))}</span>}
            </button>
          );
        })}
      </div>

      {editing ? (
        <ClaimEditor
          initial={doc ? doc.claims.map((c) => ({ body: c.body, fact_ids: c.fact_ids })) : [{ body: "", fact_ids: [] }]}
          facts={facts}
          onCancel={() => setEditing(false)}
          onSave={async (claims) => {
            await api.saveDocument(app.id, kind, claims);
            setEditing(false);
            setPicked(null);
            await onChange();
          }}
        />
      ) : (
        <>
          <div className="doc-toolbar">
            <span className="subtle small">{KINDS.find((k) => k.kind === kind)!.hint}</span>
            <div className="action-row">
              {versions.length > 1 && (
                <select
                  value={doc?.doc_version}
                  onChange={(e) => setPicked(Number(e.target.value))}
                  aria-label="Version"
                >
                  {versions.map((v) => (
                    <option key={v.doc_version} value={v.doc_version}>
                      Version {v.doc_version}
                      {v === versions[0] ? " (latest)" : ""}
                    </option>
                  ))}
                </select>
              )}
              {!locked && (
                <>
                  <Button small onClick={() => setEditing(true)}>
                    {doc ? "Edit" : "Write by hand"}
                  </Button>
                  <Button small variant="primary" busy={busy === "generate"} onClick={generate}>
                    {doc ? "Regenerate" : "Generate"}
                  </Button>
                </>
              )}
            </div>
          </div>
          {busy === "generate" && (
            <p className="subtle small">Writing with the model and validating each claim. A local model can take a minute.</p>
          )}
          {doc ? <DocumentView doc={doc} factById={factById} /> : <Empty title="Nothing written yet" />}
        </>
      )}
    </section>
  );
}

function DocumentView({ doc, factById }: { doc: DocumentOut; factById: Map<string, Fact> }) {
  return (
    <div>
      <p className="subtle small">
        <Badge tone={doc.state === "approved" ? "ok" : "info"}>{doc.state}</Badge> version {doc.doc_version}
        {doc.model ? ` · written by ${doc.model}` : " · written by you"}
      </p>
      <ol className="claims">
        {doc.claims.map((c, i) => (
          <li key={i}>
            <div>{c.body}</div>
            <div className="citations">
              {c.fact_ids.map((f) => {
                const fact = factById.get(f);
                return (
                  <span
                    key={f}
                    className={`cite${fact && fact.status !== "verified" ? " cite-stale" : ""}`}
                    title={fact ? `${fact.status}: ${fact.statement}` : f}
                  >
                    {fact ? truncate(fact.statement, 60) : "fact"}
                    {fact && fact.status !== "verified" && ` (${fact.status})`}
                  </span>
                );
              })}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function ClaimEditor({
  initial,
  facts,
  onSave,
  onCancel,
}: {
  initial: ClaimDraft[];
  facts: Fact[];
  onSave: (claims: ClaimDraft[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [claims, setClaims] = useState<ClaimDraft[]>(initial);
  const [issues, setIssues] = useState<Map<number, string[]>>(new Map());
  const [general, setGeneral] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const verified = facts.filter((f) => f.status === "verified");
  const byId = new Map(facts.map((f) => [f.id, f]));

  const update = (i: number, patch: Partial<ClaimDraft>) =>
    setClaims(claims.map((c, n) => (n === i ? { ...c, ...patch } : c)));

  const save = async () => {
    setSaving(true);
    setIssues(new Map());
    setGeneral(null);
    try {
      await onSave(claims.filter((c) => c.body.trim()));
    } catch (e) {
      if (e instanceof ApiError && e.issues.length) {
        // "claim 2: mentions kafka not found in cited facts" -> attach to row 2
        const map = new Map<number, string[]>();
        const other: string[] = [];
        for (const issue of e.issues) {
          const m = /^claim (\d+): (.*)$/.exec(issue);
          if (m) map.set(Number(m[1]), [...(map.get(Number(m[1])) ?? []), m[2]]);
          else other.push(issue);
        }
        setIssues(map);
        setGeneral(other.length ? other.join("; ") : "Fix the highlighted claims: the validator only accepts what your cited facts say.");
      } else {
        setGeneral((e as Error).message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="editor">
      <p className="subtle small">
        Each claim must cite at least one verified fact, and may only mention skills and numbers those facts contain.
        Saving creates a new version.
      </p>
      {claims.map((c, i) => (
        <div key={i} className={`claim-edit${issues.has(i) ? " has-issue" : ""}`}>
          <div className="claim-edit-row">
            <textarea
              rows={2}
              value={c.body}
              onChange={(e) => update(i, { body: e.target.value })}
              aria-label={`Claim ${i + 1}`}
            />
            <div className="claim-edit-actions">
              <button className="icon-btn" title="Move up" disabled={i === 0} onClick={() => setClaims(move(claims, i, -1))}>
                ↑
              </button>
              <button
                className="icon-btn"
                title="Move down"
                disabled={i === claims.length - 1}
                onClick={() => setClaims(move(claims, i, 1))}
              >
                ↓
              </button>
              <button className="icon-btn" title="Remove" onClick={() => setClaims(claims.filter((_, n) => n !== i))}>
                ×
              </button>
            </div>
          </div>
          <div className="citations">
            {c.fact_ids.map((f) => (
              <span key={f} className="cite">
                {truncate(byId.get(f)?.statement ?? f, 60)}
                <button
                  aria-label="Remove citation"
                  onClick={() => update(i, { fact_ids: c.fact_ids.filter((x) => x !== f) })}
                >
                  ×
                </button>
              </span>
            ))}
            <select
              value=""
              onChange={(e) => e.target.value && update(i, { fact_ids: [...c.fact_ids, e.target.value] })}
              aria-label="Cite a verified fact"
              className="cite-picker"
            >
              <option value="">+ Cite a fact</option>
              {verified
                .filter((f) => !c.fact_ids.includes(f.id))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {truncate(f.statement, 90)}
                  </option>
                ))}
            </select>
          </div>
          {issues.get(i)?.map((msg, n) => (
            <p key={n} className="form-error small">
              {msg}
            </p>
          ))}
        </div>
      ))}
      <div className="action-row">
        <Button small variant="ghost" onClick={() => setClaims([...claims, { body: "", fact_ids: [] }])}>
          + Add claim
        </Button>
      </div>
      {general && <p className="form-error">{general}</p>}
      <div className="action-row end">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" busy={saving} onClick={save} disabled={!claims.some((c) => c.body.trim())}>
          Save as new version
        </Button>
      </div>
    </div>
  );
}

function move<T>(list: T[], i: number, by: number): T[] {
  const copy = [...list];
  const [item] = copy.splice(i, 1);
  copy.splice(i + by, 0, item);
  return copy;
}
