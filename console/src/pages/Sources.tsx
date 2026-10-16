import { useState } from "react";
import { api } from "../api";
import { Badge, Button, Empty, ErrorBox, Field, Loading, PageHeader, ago, useAction, useLoad, useNotice } from "../ui";

export default function SourcesPage() {
  const sources = useLoad(api.sources);
  const { busy, run } = useAction();
  const notice = useNotice();
  const [kind, setKind] = useState<"greenhouse" | "lever">("greenhouse");
  const [slug, setSlug] = useState("");
  const [company, setCompany] = useState("");

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = kind === "greenhouse" ? "board_token" : "site";
    const config: Record<string, string> = { [key]: slug.trim().toLowerCase() };
    if (company.trim()) config.company = company.trim();
    const source = await run("add", () => api.addSource(kind, config));
    if (!source) return;
    setSlug("");
    setCompany("");
    const jobs = await run("poll-" + source.id, () => api.pollSource(source.id));
    if (jobs) notice.ok(`Board added: ${jobs.length} open roles fetched and scored`);
    await sources.reload();
  };

  const boards = (sources.data ?? []).filter((s) => s.kind === "greenhouse" || s.kind === "lever");
  const other = (sources.data ?? []).filter((s) => s.kind !== "greenhouse" && s.kind !== "lever");

  return (
    <>
      <PageHeader
        title="Job boards"
        subtitle="Company boards read through Greenhouse's and Lever's public job APIs. The worker re-checks them every 6 hours."
      />
      <form className="card form-grid" onSubmit={add}>
        <h2 className="span-all">Add a company board</h2>
        <Field label="Platform">
          <select value={kind} onChange={(e) => setKind(e.target.value as "greenhouse" | "lever")}>
            <option value="greenhouse">Greenhouse</option>
            <option value="lever">Lever</option>
          </select>
        </Field>
        <Field
          label={kind === "greenhouse" ? "Board token" : "Site name"}
          hint={
            kind === "greenhouse" ? (
              <>
                From <code>boards.greenhouse.io/<strong>acme</strong></code>
              </>
            ) : (
              <>
                From <code>jobs.lever.co/<strong>acme</strong></code>
              </>
            )
          }
        >
          <input value={slug} onChange={(e) => setSlug(e.target.value)} required pattern="[A-Za-z0-9_\-]+" />
        </Field>
        <Field label="Company name (optional)" hint="How the company should be named in job-copilot.">
          <input value={company} onChange={(e) => setCompany(e.target.value)} />
        </Field>
        <div className="action-row end span-all">
          <Button variant="primary" type="submit" busy={busy !== null}>
            Add and fetch jobs
          </Button>
        </div>
      </form>

      {sources.error && <ErrorBox error={sources.error} retry={sources.reload} />}
      {sources.loading && !sources.data && <Loading />}
      <section className="card">
        <h2>Boards</h2>
        {boards.length === 0 ? (
          <Empty title="No boards yet" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Board</th>
                  <th>Health</th>
                  <th>Last checked</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {boards.map((s) => {
                  const config = s.config as Record<string, string>;
                  return (
                    <tr key={s.id}>
                      <td>
                        <strong>{config.company ?? config.board_token ?? config.site}</strong>
                        <div className="subtle small">
                          {s.kind} · {config.board_token ?? config.site}
                        </div>
                      </td>
                      <td>
                        <Badge tone={s.health === "ok" ? "ok" : "bad"}>{s.health}</Badge>
                      </td>
                      <td className="small">{ago(s.last_polled_at)}</td>
                      <td className="right">
                        <Button
                          small
                          busy={busy === "poll-" + s.id}
                          onClick={async () => {
                            const jobs = await run("poll-" + s.id, () => api.pollSource(s.id));
                            if (jobs) notice.ok(`${jobs.length} open roles on this board`);
                            await sources.reload();
                          }}
                        >
                          Check now
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {other.length > 0 && (
        <section className="card">
          <h2>Other sources</h2>
          <ul className="plain-list">
            {other.map((s) => (
              <li key={s.id} className="small">
                <strong>{s.kind}</strong> <span className="subtle">· {s.access_basis}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
