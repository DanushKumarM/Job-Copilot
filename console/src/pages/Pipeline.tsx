import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type AppSummary } from "../api";
import { Empty, ErrorBox, Loading, PageHeader, StatusBadge, ago, useLoad } from "../ui";

const STAGES: { key: string; title: string; hint: string; statuses: string[] }[] = [
  {
    key: "attention",
    title: "Needs attention",
    hint: "Ambiguous evidence or a generation that failed validation",
    statuses: ["needs_manual_intervention", "failed"],
  },
  { key: "prepare", title: "To prepare", hint: "Generate tailored content", statuses: ["shortlisted", "prepared"] },
  { key: "review", title: "To review", hint: "Check every claim, then approve", statuses: ["awaiting_approval"] },
  {
    key: "ready",
    title: "Ready to apply",
    hint: "Open the form and click Fill in the extension",
    statuses: ["approved", "submission_in_progress"],
  },
  {
    key: "submitted",
    title: "Submitted",
    hint: "Confirmed only with a confirmation page or email",
    statuses: ["submitted_unconfirmed", "submission_confirmed"],
  },
  { key: "process", title: "In process", hint: "Assessments and interviews", statuses: ["assessment", "interview"] },
  { key: "closed", title: "Closed", hint: "", statuses: ["offer", "rejected", "withdrawn"] },
];

export default function PipelinePage() {
  const { data, error, loading, reload } = useLoad(() => api.applications());
  const [showClosed, setShowClosed] = useState(false);

  const grouped = useMemo(() => {
    const by = new Map<string, AppSummary[]>();
    for (const stage of STAGES) by.set(stage.key, []);
    for (const app of data ?? []) {
      const stage = STAGES.find((s) => s.statuses.includes(app.status));
      if (stage) by.get(stage.key)!.push(app);
    }
    return by;
  }, [data]);

  const visible = STAGES.filter(
    (s) => (s.key !== "attention" || grouped.get(s.key)!.length > 0) && (s.key !== "closed" || showClosed),
  );
  const total = [...grouped.values()].reduce((n, list) => n + list.length, 0);

  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle="Every application from shortlist to outcome. Status changes need evidence; the history is append-only."
        actions={
          <label className="check">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show
            closed ({grouped.get("closed")?.length ?? 0})
          </label>
        }
      />
      {error && <ErrorBox error={error} retry={reload} />}
      {loading && !data && <Loading />}
      {data && total === 0 && (
        <Empty title="No applications yet">
          Shortlist a job from the <Link to="/jobs">Jobs</Link> page; jobs that score above your threshold are
          shortlisted for you.
        </Empty>
      )}
      {data && total > 0 && (
        <div className="board">
          {visible.map((stage) => {
            const apps = grouped.get(stage.key)!;
            return (
              <section key={stage.key} className={`column column-${stage.key}`}>
                <header>
                  <h2>
                    {stage.title} <span className="seg-count">{apps.length}</span>
                  </h2>
                  {stage.hint && <p className="subtle small">{stage.hint}</p>}
                </header>
                {apps.length === 0 ? (
                  <p className="subtle small column-empty">Nothing here</p>
                ) : (
                  apps.map((app) => (
                    <Link key={app.id} to={`/applications/${app.id}`} className="card app-card">
                      <div className="app-card-title">{app.job_title}</div>
                      <div className="subtle small">{app.company}</div>
                      <div className="app-card-foot">
                        <StatusBadge status={app.status} />
                        <span className="subtle small">
                          {app.score !== null && app.score !== undefined ? `${app.score} · ` : ""}
                          {ago(app.updated_at)}
                        </span>
                      </div>
                    </Link>
                  ))
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
