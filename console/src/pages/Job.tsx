import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Fact, type JobDetail } from "../api";
import {
  Badge,
  Button,
  ErrorBox,
  Loading,
  PageHeader,
  Score,
  StatusBadge,
  WORK_MODES,
  ago,
  useAction,
  useLoad,
} from "../ui";

const COVERAGE: Record<string, { label: string; tone: "ok" | "warn" | "bad" }> = {
  full: { label: "Covered", tone: "ok" },
  partial: { label: "Partly", tone: "warn" },
  gap: { label: "Gap", tone: "bad" },
};
const RANK: Record<string, number> = { gap: 0, partial: 1, full: 2 };

export default function JobPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const job = useLoad(() => api.job(id), [id]);
  const facts = useLoad(() => api.facts(), []);
  const { busy, run } = useAction();

  const factById = useMemo(() => new Map((facts.data ?? []).map((f) => [f.id, f])), [facts.data]);

  if (job.error) return <ErrorBox error={job.error} retry={job.reload} />;
  if (!job.data) return <Loading />;
  const j = job.data;

  const shortlist = async () => {
    const app = await run("shortlist", () => api.shortlist(j.id), "Shortlisted");
    if (app) navigate(`/applications/${app.id}`);
  };
  const refine = async () => {
    const updated = await run("refine", () => api.extract(j.id), "Requirements re-extracted and re-scored");
    if (updated) job.setData(updated);
  };
  const reevaluate = async () => {
    await run("evaluate", () => api.evaluate(j.id), "Re-scored with your current facts and filters");
    await job.reload();
  };

  const canShortlist = !j.application_status || ["discovered", "rejected_by_rules"].includes(j.application_status);
  const postingUrl = j.postings.find((p) => p.url)?.url;

  return (
    <>
      <PageHeader
        back={
          <Link to="/jobs" className="back">
            ← Jobs
          </Link>
        }
        title={j.title}
        subtitle={
          <>
            {j.company}
            {j.location ? ` · ${j.location}` : ""} · {WORK_MODES[j.work_mode]}
            {j.freshness !== "fresh" && (
              <>
                {" "}
                <Badge tone={j.freshness === "closed" ? "bad" : "muted"}>{j.freshness}</Badge>
              </>
            )}
          </>
        }
        actions={
          <>
            {postingUrl && (
              <a className="btn btn-ghost" href={postingUrl} target="_blank" rel="noreferrer">
                Open posting ↗
              </a>
            )}
            {canShortlist ? (
              <Button variant="primary" busy={busy === "shortlist"} onClick={shortlist}>
                Shortlist
              </Button>
            ) : (
              <Link className="btn btn-primary" to={`/applications/${j.application_id}`}>
                Open application
              </Link>
            )}
          </>
        }
      />

      <div className="grid-2">
        <ScoreCard job={j} onReevaluate={reevaluate} busy={busy === "evaluate"} />
        <section className="card">
          <h2>Postings</h2>
          <p className="subtle">One job can be seen on several sources; they are merged by company and title.</p>
          <ul className="plain-list">
            {j.postings.map((p) => (
              <li key={p.id} className="posting">
                <div>
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noreferrer">
                      {new URL(p.url).hostname}
                    </a>
                  ) : (
                    "Pasted or from an email"
                  )}
                  <div className="subtle small">
                    Seen {ago(p.fetched_at)}
                    {p.merge_confidence < 1 && ` · merged at ${Math.round(p.merge_confidence * 100)}% title match`}
                  </div>
                </div>
                {j.postings.length > 1 && (
                  <Button
                    small
                    variant="ghost"
                    busy={busy === `split-${p.id}`}
                    onClick={async () => {
                      const created = await run(
                        `split-${p.id}`,
                        () => api.splitPosting(p.id),
                        "Split into a job of its own",
                      );
                      if (created) navigate(`/jobs/${created.id}`);
                    }}
                    title="These are different roles: give this posting its own job"
                  >
                    Not the same role
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Requirements</h2>
            <p className="subtle">
              {extractorLabel(j.extractor_version)} Each one is matched to your verified facts; gaps are shown, never
              papered over.
            </p>
          </div>
          {j.description && (
            <Button small busy={busy === "refine"} onClick={refine} title="Uses the model set in JOBCOPILOT_EXTRACTION_PROVIDER">
              Re-extract with AI
            </Button>
          )}
        </div>
        {j.requirements.length === 0 ? (
          <p className="subtle">
            No requirements found{j.description ? "" : ": this job has no description yet (it came from an alert email)"}.
          </p>
        ) : (
          <Requirements job={j} factById={factById} />
        )}
      </section>

      {j.description && (
        <details className="card description">
          <summary>
            <h2>Job description</h2>
          </summary>
          <pre className="prose">{j.description}</pre>
        </details>
      )}
    </>
  );
}

function extractorLabel(version: string | null | undefined) {
  if (!version) return "";
  if (version === "llm-v1:failed") return "Extracted by rules (the model's attempt gave nothing usable).";
  if (version.startsWith("llm")) return "Extracted by the model, checked against the description.";
  return "Extracted by rules.";
}

function ScoreCard({ job, onReevaluate, busy }: { job: JobDetail; onReevaluate: () => void; busy: boolean }) {
  const e = job.evaluation;
  const components = (e?.breakdown?.components ?? {}) as Record<string, { weight: number; coverage: number; points: number }>;
  const notes = (e?.breakdown?.filter_notes ?? []) as string[];
  return (
    <section className="card">
      <div className="card-head">
        <h2>Fit</h2>
        <Button small variant="ghost" busy={busy} onClick={onReevaluate}>
          Re-score
        </Button>
      </div>
      {!e ? (
        <p className="subtle">Not scored yet.</p>
      ) : (
        <div className="score-card">
          <Score value={e.hard_filter_pass ? e.score : null} size={84} />
          <div className="score-detail">
            {!e.hard_filter_pass ? (
              <>
                <strong>Filtered out by your preferences</strong>
                <ul className="reasons">
                  {e.hard_filter_reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <Link to="/profile?tab=preferences" className="small">
                  Change preferences
                </Link>
              </>
            ) : (
              <>
                {Object.entries(components).map(([group, c]) => (
                  <div key={group} className="component">
                    <div className="component-label">
                      <span>{group === "must" ? "Must-haves" : "Nice-to-haves"}</span>
                      <span className="subtle small">
                        {Math.round(c.coverage * 100)}% covered × {Math.round(c.weight * 100)}% weight ={" "}
                        <strong>{c.points}</strong> pts
                      </span>
                    </div>
                    <div className="meter">
                      <div style={{ width: `${c.coverage * 100}%` }} />
                    </div>
                  </div>
                ))}
                {Object.keys(components).length === 0 && <p className="subtle">No requirements to score against.</p>}
              </>
            )}
            {notes.length > 0 && <p className="subtle small">Passed, but: {notes.join("; ")}.</p>}
            <p className="subtle small">
              <StatusBadge status={job.application_status} /> scored {ago(e.created_at)} · {e.scorer_version}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function Requirements({ job, factById }: { job: JobDetail; factById: Map<string, Fact> }) {
  const byReq = new Map<string, JobDetail["matches"]>();
  for (const m of job.matches) byReq.set(m.requirement_id, [...(byReq.get(m.requirement_id) ?? []), m]);
  const ordered = [...job.requirements].sort((a, b) => (a.importance === b.importance ? 0 : a.importance === "must" ? -1 : 1));

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Requirement</th>
            <th>Coverage</th>
            <th>Supported by</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((r) => {
            const matches = byReq.get(r.id) ?? [];
            const best = matches.reduce((acc, m) => (RANK[m.coverage] > RANK[acc] ? m.coverage : acc), "gap");
            const supporting = matches.filter((m) => m.fact_id);
            return (
              <tr key={r.id}>
                <td>
                  <Badge tone={r.importance === "must" ? "neutral" : "muted"}>{r.importance === "must" ? "Must" : "Nice"}</Badge>{" "}
                  {r.statement}
                </td>
                <td>{job.evaluation?.hard_filter_pass ? <Badge tone={COVERAGE[best].tone}>{COVERAGE[best].label}</Badge> : "–"}</td>
                <td className="small">
                  {supporting.length === 0 ? (
                    <span className="subtle">{job.evaluation?.hard_filter_pass ? "No verified fact" : ""}</span>
                  ) : (
                    supporting.map((m) => (
                      <div key={m.fact_id} className="support">
                        “{factById.get(m.fact_id!)?.statement ?? "a fact"}”
                        <span className="subtle"> · {m.rationale}</span>
                      </div>
                    ))
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
