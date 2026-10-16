import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type Answer, type Fact, type FactKind, type Preferences } from "../api";
import {
  Badge,
  Button,
  Empty,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
  WORK_MODES,
  ago,
  useAction,
  useLoad,
  useNotice,
} from "../ui";

const TABS = [
  { key: "facts", label: "Facts" },
  { key: "contact", label: "Contact details" },
  { key: "answers", label: "Saved answers" },
  { key: "preferences", label: "Filters" },
];

const KINDS: FactKind[] = ["skill", "experience", "role", "project", "achievement", "education", "certification", "other"];

export default function ProfilePage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "facts";
  return (
    <>
      <PageHeader
        title="Profile"
        subtitle="Only facts you have verified are ever used in an application. Corrections supersede; nothing is edited in place."
      />
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? "active" : ""}
            onClick={() => setParams({ tab: t.key })}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "facts" && <Facts />}
      {tab === "contact" && <Contact />}
      {tab === "answers" && <Answers />}
      {tab === "preferences" && <PreferencesForm />}
    </>
  );
}

// --- facts ---------------------------------------------------------------------------------------

function Facts() {
  const facts = useLoad(() => api.facts());
  const [showOld, setShowOld] = useState(false);
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);

  const groups = useMemo(() => {
    const all = facts.data ?? [];
    return {
      proposed: all.filter((f) => f.status === "proposed"),
      verified: all.filter((f) => f.status === "verified"),
      old: all.filter((f) => f.status === "rejected" || f.status === "superseded"),
    };
  }, [facts.data]);

  if (facts.error) return <ErrorBox error={facts.error} retry={facts.reload} />;
  if (!facts.data) return <Loading />;

  return (
    <>
      <div className="action-row">
        <Button variant="primary" onClick={() => setImporting(!importing)}>
          Import resume text
        </Button>
        <Button onClick={() => setAdding(!adding)}>Add a fact</Button>
      </div>
      {importing && <ResumeImport onDone={() => (setImporting(false), facts.reload())} />}
      {adding && <AddFact onDone={() => (setAdding(false), facts.reload())} />}

      {groups.proposed.length > 0 && (
        <section className="card next-warn">
          <h2>
            To verify <span className="seg-count">{groups.proposed.length}</span>
          </h2>
          <p className="subtle">
            Proposed from your resume. Check each one: verify it if it is true as written, correct it, or reject it.
          </p>
          <ul className="fact-list">
            {groups.proposed.map((f) => (
              <FactRow key={f.id} fact={f} onChange={facts.reload} />
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>
          Verified <span className="seg-count">{groups.verified.length}</span>
        </h2>
        {groups.verified.length === 0 ? (
          <Empty title="No verified facts yet">Import your resume, then verify the facts it proposes.</Empty>
        ) : (
          <ul className="fact-list">
            {groups.verified.map((f) => (
              <FactRow key={f.id} fact={f} onChange={facts.reload} />
            ))}
          </ul>
        )}
      </section>

      {groups.old.length > 0 && (
        <section className="card">
          <button className="link-btn" onClick={() => setShowOld(!showOld)}>
            {showOld ? "Hide" : "Show"} rejected and superseded facts ({groups.old.length})
          </button>
          {showOld && (
            <ul className="fact-list">
              {groups.old.map((f) => (
                <FactRow key={f.id} fact={f} onChange={facts.reload} />
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

function FactRow({ fact, onChange }: { fact: Fact; onChange: () => void }) {
  const { busy, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.statement);
  const details = fact.details as { skills?: string[]; years?: number; total_years?: number };
  const act = async (key: string, action: () => Promise<unknown>, msg: string) => {
    if (await run(key, action, msg)) onChange();
  };

  return (
    <li className={`fact fact-${fact.status}`}>
      <div className="fact-main">
        <Badge tone="muted">{fact.kind}</Badge>
        {editing ? (
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} aria-label="Corrected statement" />
        ) : (
          <span className="fact-statement">{fact.statement}</span>
        )}
        <div className="fact-meta subtle small">
          {details.skills && details.skills.length > 0 && <span>skills: {details.skills.join(", ")}</span>}
          {details.total_years !== undefined && <span>{details.total_years} years total</span>}
          {details.years !== undefined && <span>{details.years} years</span>}
          {fact.verified_at && <span>verified {ago(fact.verified_at)}</span>}
          {fact.status === "superseded" && <span>superseded by a correction</span>}
          {fact.status === "rejected" && <span>rejected</span>}
        </div>
      </div>
      <div className="fact-actions">
        {editing ? (
          <>
            <Button small variant="ghost" onClick={() => (setEditing(false), setText(fact.statement))}>
              Cancel
            </Button>
            <Button
              small
              variant="primary"
              busy={busy === "revise"}
              disabled={text.trim().length < 3 || text.trim() === fact.statement}
              onClick={() => act("revise", () => api.reviseFact(fact.id, text.trim()), "Corrected and verified")}
            >
              Save correction
            </Button>
          </>
        ) : fact.status === "proposed" ? (
          <>
            <Button
              small
              variant="primary"
              busy={busy === "verify"}
              onClick={() => act("verify", () => api.verifyFact(fact.id), "Verified")}
            >
              Verify
            </Button>
            <Button small onClick={() => setEditing(true)}>
              Correct
            </Button>
            <Button
              small
              variant="ghost"
              busy={busy === "reject"}
              onClick={() => act("reject", () => api.rejectFact(fact.id), "Rejected")}
            >
              Reject
            </Button>
          </>
        ) : fact.status === "verified" ? (
          <Button small variant="ghost" onClick={() => setEditing(true)}>
            Revise
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function ResumeImport({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  const [name, setName] = useState("resume.txt");
  const { busy, run } = useAction();
  const notice = useNotice();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const facts = await run("import", () => api.importResume(text, name));
    if (facts) {
      notice.ok(`${facts.length} facts proposed. Verify each one below.`);
      onDone();
    }
  };
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setName(file.name);
    setText(await file.text());
  };
  return (
    <form className="card" onSubmit={submit}>
      <h2>Import resume text</h2>
      <p className="subtle small">
        Paste plain text, or pick a .txt or .md export. Bullets become facts; a “Skills:” line becomes one fact per
        skill; “N years of experience” becomes your total experience. Nothing is used until you verify it.
      </p>
      <Field label="File (optional)">
        <input type="file" accept=".txt,.md,text/plain" onChange={(e) => readFile(e.target.files?.[0])} />
      </Field>
      <Field label="Resume text">
        <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} required minLength={20} />
      </Field>
      <div className="action-row end">
        <Button variant="primary" busy={busy === "import"} type="submit">
          Propose facts
        </Button>
      </div>
    </form>
  );
}

function AddFact({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState<FactKind>("achievement");
  const [statement, setStatement] = useState("");
  const [skills, setSkills] = useState("");
  const [years, setYears] = useState("");
  const { busy, run } = useAction();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const details: Record<string, unknown> = {};
    const list = skills.split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length) details.skills = list;
    if (years) details[kind === "experience" ? "total_years" : "years"] = Number(years);
    const fact = await run("add", () => api.addFact(kind, statement.trim(), details));
    if (fact && (await run("verify", () => api.verifyFact(fact.id), "Fact added and verified"))) onDone();
  };
  return (
    <form className="card form-grid" onSubmit={submit}>
      <h2 className="span-all">Add a fact</h2>
      <Field label="Kind">
        <select value={kind} onChange={(e) => setKind(e.target.value as FactKind)}>
          {KINDS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </Field>
      <Field label="Statement" hint="One true, specific sentence. Numbers and skills here are what claims may cite.">
        <textarea rows={2} value={statement} onChange={(e) => setStatement(e.target.value)} required minLength={3} />
      </Field>
      <Field label="Skills it shows (comma separated)">
        <input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="Python, Kafka" />
      </Field>
      <Field label={kind === "experience" ? "Total years of experience" : "Years using these skills"}>
        <input type="number" min={0} step={0.5} value={years} onChange={(e) => setYears(e.target.value)} />
      </Field>
      <div className="action-row end span-all">
        <Button variant="primary" busy={busy !== null} type="submit">
          Add and verify
        </Button>
      </div>
    </form>
  );
}

// --- contact and answers -------------------------------------------------------------------------

function Contact() {
  const status = useLoad(api.status);
  const answers = useLoad(api.answers);
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const { busy, run } = useAction();

  if (status.error || answers.error) return <ErrorBox error={(status.error ?? answers.error)!} />;
  if (!status.data || !answers.data) return <Loading />;
  const fields = status.data.contact_fields;
  const saved = Object.fromEntries(answers.data.map((a) => [a.question_key, a.answer]));
  const current = values ?? Object.fromEntries(Object.keys(fields).map((k) => [k, saved[k] ?? ""]));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const changed = Object.entries(current).filter(([k, v]) => v.trim() && v.trim() !== (saved[k] ?? ""));
    await run(
      "save",
      async () => {
        for (const [k, v] of changed) await api.saveAnswer(k, fields[k], v.trim());
      },
      changed.length ? "Contact details saved" : "Nothing changed",
    );
    setValues(null);
    await answers.reload();
  };

  return (
    <form className="card form-grid" onSubmit={save}>
      <p className="subtle span-all">
        Printed at the top of the resume PDF and filled into application forms by the extension.
      </p>
      {Object.entries(fields).map(([key, label]) => (
        <Field key={key} label={label}>
          <input
            value={current[key]}
            type={key === "email" ? "email" : "text"}
            onChange={(e) => setValues({ ...current, [key]: e.target.value })}
          />
        </Field>
      ))}
      <div className="action-row end span-all">
        <Button variant="primary" busy={busy === "save"} type="submit">
          Save
        </Button>
      </div>
    </form>
  );
}

const PRESETS: [string, string][] = [
  ["notice_period", "What is your notice period?"],
  ["current_ctc", "What is your current CTC?"],
  ["expected_ctc", "What is your expected CTC?"],
  ["years_of_experience", "How many years of experience do you have?"],
  ["work_authorization", "Are you authorised to work in India?"],
  ["willing_to_relocate", "Are you willing to relocate?"],
];

function Answers() {
  const status = useLoad(api.status);
  const answers = useLoad(api.answers);
  const [adding, setAdding] = useState<{ key: string; question: string; answer: string } | null>(null);
  const { busy, run } = useAction();

  if (answers.error) return <ErrorBox error={answers.error} retry={answers.reload} />;
  if (!answers.data || !status.data) return <Loading />;
  const contact = new Set(Object.keys(status.data.contact_fields));
  const list = answers.data.filter((a) => !contact.has(a.question_key));
  const existing = new Set(answers.data.map((a) => a.question_key));

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adding) return;
    const key = adding.key || slug(adding.question);
    if (await run("add", () => api.saveAnswer(key, adding.question, adding.answer), "Answer saved")) {
      setAdding(null);
      await answers.reload();
    }
  };

  return (
    <>
      <section className="card">
        <p className="subtle">
          Reusable answers for application forms. An answer older than 90 days is flagged so you confirm it is still
          true before it goes into a form.
        </p>
        {list.length === 0 && <Empty title="No saved answers yet" />}
        <ul className="answer-list">
          {list.map((a) => (
            <AnswerRow key={a.question_key} answer={a} onChange={answers.reload} />
          ))}
        </ul>
        {!adding && (
          <div className="action-row">
            <Button onClick={() => setAdding({ key: "", question: "", answer: "" })}>Add an answer</Button>
            {PRESETS.filter(([k]) => !existing.has(k)).map(([k, q]) => (
              <Button key={k} small variant="ghost" onClick={() => setAdding({ key: k, question: q, answer: "" })}>
                + {q}
              </Button>
            ))}
          </div>
        )}
      </section>
      {adding && (
        <form className="card form-grid" onSubmit={add}>
          <Field label="Question">
            <input value={adding.question} onChange={(e) => setAdding({ ...adding, question: e.target.value })} required />
          </Field>
          <Field label="Answer">
            <textarea rows={2} value={adding.answer} onChange={(e) => setAdding({ ...adding, answer: e.target.value })} required />
          </Field>
          <div className="action-row end span-all">
            <Button variant="ghost" onClick={() => setAdding(null)}>
              Cancel
            </Button>
            <Button variant="primary" busy={busy === "add"} type="submit">
              Save answer
            </Button>
          </div>
        </form>
      )}
    </>
  );
}

function AnswerRow({ answer, onChange }: { answer: Answer; onChange: () => void }) {
  const [text, setText] = useState(answer.answer);
  const { busy, run } = useAction();
  const save = async (message: string) => {
    if (await run("save", () => api.saveAnswer(answer.question_key, answer.question, text.trim()), message)) onChange();
  };
  return (
    <li className="answer">
      <div className="answer-q">
        {answer.question}
        {answer.stale && <Badge tone="warn">confirm it is still true</Badge>}
      </div>
      <div className="answer-edit">
        <input value={text} onChange={(e) => setText(e.target.value)} aria-label={answer.question} />
        {text.trim() !== answer.answer ? (
          <Button small variant="primary" busy={busy === "save"} onClick={() => save("Answer updated")}>
            Save
          </Button>
        ) : (
          answer.stale && (
            <Button small busy={busy === "save"} onClick={() => save("Confirmed")}>
              Still true
            </Button>
          )
        )}
      </div>
      <div className="subtle small">confirmed {ago(answer.last_confirmed_at)}</div>
    </li>
  );
}

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60) || "answer";
}

// --- preferences ---------------------------------------------------------------------------------

function PreferencesForm() {
  const prefs = useLoad(api.preferences);
  const [form, setForm] = useState<Preferences | null>(null);
  const { busy, run } = useAction();
  if (prefs.error) return <ErrorBox error={prefs.error} retry={prefs.reload} />;
  if (!prefs.data) return <Loading />;
  const p = form ?? prefs.data;
  const list = (key: keyof Preferences) => ((p[key] as string[] | undefined) ?? []).join(", ");
  const setList = (key: keyof Preferences) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...p, [key]: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) });
  const modes = (p.work_modes ?? []) as string[];

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const saved = await run("save", () => api.savePreferences(p), "Filters saved. Open jobs are being re-scored.");
    if (saved) {
      prefs.setData(saved);
      setForm(null);
    }
  };

  return (
    <form className="card form-grid" onSubmit={save}>
      <p className="subtle span-all">
        Hard filters run before anything else. A job that fails one is filtered out, with the reason shown. Empty means
        no constraint. Lists are comma separated.
      </p>
      <Field label="Locations" hint="Remote jobs pass regardless.">
        <input value={list("locations")} onChange={setList("locations")} placeholder="Bengaluru, Pune" />
      </Field>
      <Field label="Work modes">
        <div className="check-row">
          {(["onsite", "hybrid", "remote"] as const).map((m) => (
            <label key={m} className="check">
              <input
                type="checkbox"
                checked={modes.includes(m)}
                onChange={(e) =>
                  setForm({ ...p, work_modes: e.target.checked ? [...modes, m] : modes.filter((x) => x !== m) } as Preferences)
                }
              />{" "}
              {WORK_MODES[m]}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Minimum salary (annual INR)" hint="Only checked when a posting discloses a range.">
        <input
          type="number"
          min={0}
          step={100000}
          value={p.min_salary ?? ""}
          onChange={(e) => setForm({ ...p, min_salary: e.target.value ? Number(e.target.value) : null })}
        />
      </Field>
      <Field label="Shortlist automatically at score" hint="Jobs that pass the filters and score this or more.">
        <input
          type="number"
          min={0}
          max={100}
          value={p.shortlist_score ?? 60}
          onChange={(e) => setForm({ ...p, shortlist_score: Number(e.target.value) })}
        />
      </Field>
      <Field label="Title must include one of">
        <input value={list("title_include")} onChange={setList("title_include")} placeholder="backend, platform" />
      </Field>
      <Field label="Title must not include">
        <input value={list("title_exclude")} onChange={setList("title_exclude")} placeholder="intern, principal" />
      </Field>
      <Field label="Excluded companies">
        <input value={list("excluded_companies")} onChange={setList("excluded_companies")} />
      </Field>
      <div className="action-row end span-all">
        {form && (
          <Button variant="ghost" onClick={() => setForm(null)}>
            Discard
          </Button>
        )}
        <Button variant="primary" busy={busy === "save"} disabled={!form} type="submit">
          Save filters
        </Button>
      </div>
    </form>
  );
}
