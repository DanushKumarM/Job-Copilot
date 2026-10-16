import { Link } from "react-router-dom";
import { api } from "../api";
import { Empty, ErrorBox, Loading, PageHeader, STATUS, StatusBadge, useLoad } from "../ui";

const STAGES: [string, string][] = [
  ["discovered", "Discovered"],
  ["shortlisted", "Shortlisted"],
  ["approved", "Approved"],
  ["submitted", "Submitted"],
  ["confirmed", "Confirmed"],
  ["assessment", "Assessment"],
  ["interview", "Interview"],
  ["offer", "Offer"],
];

export default function InsightsPage() {
  const { data, error, loading, reload } = useLoad(api.funnel);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;

  const top = Math.max(1, data.funnel.discovered ?? 0);
  const sources = Object.keys(data.by_source);
  const current = Object.entries(data.current_status).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <PageHeader
        title="Insights"
        subtitle="Counts, not recommendations. A stage counts every application that ever reached it, from the event log."
      />
      <section className="card">
        <h2>Funnel</h2>
        {top <= 1 && (data.funnel.discovered ?? 0) === 0 ? (
          <Empty title="Nothing to count yet" />
        ) : (
          <div className="funnel">
            {STAGES.map(([key, label]) => {
              const n = data.funnel[key] ?? 0;
              return (
                <div key={key} className="funnel-row">
                  <span className="funnel-label">{label}</span>
                  <div className="funnel-bar" aria-hidden="true">
                    <div style={{ width: `${(n / top) * 100}%` }} />
                  </div>
                  <span className="funnel-value">{n}</span>
                </div>
              );
            })}
          </div>
        )}
        {data.submitted_unconfirmed_now > 0 && (
          <p className="subtle small">
            {data.submitted_unconfirmed_now} submitted but not yet confirmed. Some portals never send a confirmation, so
            these are counted separately.
          </p>
        )}
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>By source</h2>
          {sources.length === 0 ? (
            <p className="subtle">No sources yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table numeric">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Found</th>
                    <th>Submitted</th>
                    <th>Confirmed</th>
                    <th>Interview</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s}>
                      <td>{s.replaceAll("_", " ")}</td>
                      <td>{data.by_source[s].discovered}</td>
                      <td>{data.by_source[s].submitted}</td>
                      <td>{data.by_source[s].confirmed}</td>
                      <td>{data.by_source[s].interview}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="card">
          <h2>Right now</h2>
          <ul className="plain-list status-counts">
            {current.map(([status, n]) => (
              <li key={status}>
                <StatusBadge status={status} />
                <span>{n}</span>
              </li>
            ))}
          </ul>
          {(data.current_status.needs_manual_intervention ?? 0) > 0 && (
            <p className="small">
              <Link to="/applications">{STATUS.needs_manual_intervention.label}</Link>: decide these first.
            </p>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Model usage</h2>
        <div className="stats">
          <div>
            <span className="stat-value">{data.llm.calls}</span>
            <span className="subtle small">calls</span>
          </div>
          <div>
            <span className="stat-value">{data.llm.tokens.toLocaleString()}</span>
            <span className="subtle small">tokens</span>
          </div>
          <div>
            <span className="stat-value">₹{data.llm.cost_inr.toFixed(2)}</span>
            <span className="subtle small">spent</span>
          </div>
        </div>
        <p className="subtle small">Prompts are logged only as hashes; your resume never lands in a log.</p>
      </section>
    </>
  );
}
