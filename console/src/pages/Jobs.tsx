import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type JobSummary, type PastedJob } from "../api";
import {
  Badge,
  Button,
  Empty,
  ErrorBox,
  Field,
  Loading,
  Modal,
  PageHeader,
  Score,
  StatusBadge,
  WORK_MODES,
  useAction,
  useLoad,
} from "../ui";

const FILTERS: { key: string; label: string; test: (j: JobSummary) => boolean }[] = [
  { key: "open", label: "Worth a look", test: (j) => ["shortlisted", "discovered"].includes(j.application_status ?? "") },
  { key: "active", label: "Applying", test: (j) => !["shortlisted", "discovered", "rejected_by_rules", null].includes(j.application_status) },
  { key: "filtered", label: "Filtered out", test: (j) => j.application_status === "rejected_by_rules" },
  { key: "all", label: "All", test: () => true },
];

export default function JobsPage() {
  const { data, error, loading, reload } = useLoad(api.jobs);
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"score" | "recent">("score");
  const [adding, setAdding] = useState(false);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, (data ?? []).filter(f.test).length])),
    [data],
  );
  const shown = useMemo(() => {
    const test = FILTERS.find((f) => f.key === filter)!.test;
    const needle = search.trim().toLowerCase();
    const list = (data ?? []).filter(
      (j) => test(j) && (!needle || `${j.title} ${j.company} ${j.location ?? ""}`.toLowerCase().includes(needle)),
    );
    // The API returns most recently seen first.
    return sort === "score" ? [...list].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)) : list;
  }, [data, filter, search, sort]);

  return (
    <>
      <PageHeader
        title="Jobs"
        subtitle="Scored against your verified facts. Hard filters run first; the score is arithmetic you can inspect."
        actions={
          <>
            <Link className="btn btn-ghost" to="/sources">
              Job boards
            </Link>
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add a job
            </Button>
          </>
        }
      />

      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label="Filter jobs">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              className={filter === f.key ? "active" : ""}
              onClick={() => setFilter(f.key)}
            >
              {f.label} <span className="seg-count">{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <input
            type="search"
            placeholder="Search title, company, place"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search jobs"
          />
          <select value={sort} onChange={(e) => setSort(e.target.value as "score" | "recent")} aria-label="Sort">
            <option value="score">Best fit first</option>
            <option value="recent">Recently seen</option>
          </select>
        </div>
      </div>

      {error && <ErrorBox error={error} retry={reload} />}
      {loading && !data && <Loading />}
      {data && shown.length === 0 && (
        <Empty title={data.length === 0 ? "No jobs yet" : "Nothing matches"}>
          {data.length === 0
            ? "Paste a job description, add a Greenhouse or Lever board, or connect Gmail so job alerts arrive here."
            : "Try another filter or search."}
        </Empty>
      )}
      <ul className="job-list">
        {shown.map((job) => (
          <li key={job.id}>
            <Link to={`/jobs/${job.id}`} className="job-row card">
              <Score value={job.score} />
              <div className="job-main">
                <div className="job-title">{job.title}</div>
                <div className="subtle">
                  {job.company}
                  {job.location ? ` · ${job.location}` : ""}
                  {job.work_mode !== "unknown" ? ` · ${WORK_MODES[job.work_mode]}` : ""}
                </div>
              </div>
              <div className="job-tags">
                {job.freshness !== "fresh" && (
                  <Badge tone={job.freshness === "closed" ? "bad" : "muted"}>
                    {job.freshness === "closed" ? "Closed" : "Stale"}
                  </Badge>
                )}
                <StatusBadge status={job.application_status} />
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {adding && <AddJob onClose={() => setAdding(false)} />}
    </>
  );
}

function AddJob({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { busy, run } = useAction();
  const [form, setForm] = useState<PastedJob>({
    title: "",
    company: "",
    description: "",
    url: "",
    location: "",
    work_mode: "unknown",
  });
  const set = (key: keyof PastedJob) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const job = await run(
      "add",
      () => api.pasteJob({ ...form, url: form.url || null, location: form.location || null }),
      "Job added and scored",
    );
    if (job) navigate(`/jobs/${job.id}`);
  };

  return (
    <Modal
      title="Add a job"
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy === "add"} type="submit" form="add-job">
            Add and score
          </Button>
        </>
      }
    >
      <form id="add-job" className="form-grid" onSubmit={submit}>
        <Field label="Job title">
          <input value={form.title} onChange={set("title")} required minLength={2} />
        </Field>
        <Field label="Company">
          <input value={form.company} onChange={set("company")} required />
        </Field>
        <Field label="Location">
          <input value={form.location ?? ""} onChange={set("location")} placeholder="Bengaluru" />
        </Field>
        <Field label="Work mode">
          <select value={form.work_mode} onChange={set("work_mode")}>
            {Object.entries(WORK_MODES).map(([v, l]) => (
              <option key={v} value={v}>
                {v === "unknown" ? "Not stated" : l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Link to the posting" hint="Lets the browser extension recognise the application page.">
          <input type="url" value={form.url ?? ""} onChange={set("url")} placeholder="https://" />
        </Field>
        <Field label="Job description" hint="Paste the whole thing, including the requirements lists.">
          <textarea value={form.description} onChange={set("description")} rows={12} required minLength={20} />
        </Field>
      </form>
    </Modal>
  );
}
