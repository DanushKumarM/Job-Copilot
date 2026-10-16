import { Link } from "react-router-dom";
import { api } from "../api";
import { Card, Empty, ErrorBox, Loading, PageHeader, useLoad } from "../ui";

export default function HomePage() {
  const facts = useLoad(() => api.facts());
  const jobs = useLoad(api.jobs);
  const applications = useLoad(() => api.applications());

  if (facts.error || jobs.error || applications.error) {
    return <ErrorBox error={(facts.error ?? jobs.error ?? applications.error)!} />;
  }
  if (!facts.data || !jobs.data || !applications.data) return <Loading label="Preparing your workspace" />;

  const verified = facts.data.filter((fact) => fact.status === "verified").length;
  const proposed = facts.data.filter((fact) => fact.status === "proposed").length;
  const active = applications.data.filter(
    (application) => !["rejected", "withdrawn", "rejected_by_rules"].includes(application.status),
  ).length;
  const needsReview = applications.data.filter((application) =>
    ["awaiting_approval", "needs_manual_intervention"].includes(application.status),
  ).length;
  const profileReady = verified > 0;
  const jobReady = jobs.data.length > 0;
  const applicationReady = applications.data.some((application) =>
    ["shortlisted", "prepared", "awaiting_approval", "approved"].includes(application.status),
  );

  return (
    <>
      <PageHeader
        title="Your job search"
        subtitle="Use this space to move from your verified profile to a reviewed, honest application."
        actions={
          <Link className="btn btn-primary" to={profileReady ? "/jobs" : "/profile"}>
            {profileReady ? "Find a job" : "Set up your profile"}
          </Link>
        }
      />

      <section className="welcome-hero card">
        <div>
          <span className="eyebrow">Your next step</span>
          <h2>{!profileReady ? "Start with your profile" : !jobReady ? "Add your first job" : "Choose a job to work on"}</h2>
          <p className="subtle">
            {!profileReady
              ? "Import your resume and verify the facts before anything is used in an application."
              : !jobReady
                ? "Paste a job description and we will score it against your verified experience."
                : "Open a job, review the fit, and shortlist it when you want to prepare an application."}
          </p>
        </div>
        <div className="welcome-illustration" aria-hidden="true">
          <span>1</span>
          <span>2</span>
          <span>3</span>
        </div>
      </section>

      <div className="home-grid">
        <Card>
          <div className="step-number">1</div>
          <h2>Verify your profile</h2>
          <p className="subtle">Your resume becomes small, reviewable facts. Only verified facts can support generated claims.</p>
          <div className="stat-line">
            <strong>{verified}</strong> verified
            {proposed > 0 && <span className="stat-warn">{proposed} to review</span>}
          </div>
          <Link className="btn btn-ghost" to="/profile">
            {proposed > 0 ? "Review facts" : "Open profile"}
          </Link>
        </Card>

        <Card>
          <div className="step-number">2</div>
          <h2>Review job fit</h2>
          <p className="subtle">Add a job or connect a board. Scores show which requirements your profile supports.</p>
          <div className="stat-line">
            <strong>{jobs.data.length}</strong> jobs
            <span>{active} active applications</span>
          </div>
          <Link className="btn btn-ghost" to="/jobs">
            Browse jobs
          </Link>
        </Card>

        <Card>
          <div className="step-number">3</div>
          <h2>Prepare an application</h2>
          <p className="subtle">Generate cited content, review it yourself, then approve it before filling a form.</p>
          <div className="stat-line">
            <strong>{needsReview}</strong> need review
            <span>{applicationReady ? "Ready to continue" : "None started yet"}</span>
          </div>
          <Link className="btn btn-ghost" to="/applications">
            Open pipeline
          </Link>
        </Card>
      </div>

      <section className="card home-guide">
        <div className="card-head">
          <div>
            <h2>How job-copilot works</h2>
            <p className="subtle">You stay in control. The system prepares and explains; you decide and submit.</p>
          </div>
        </div>
        <div className="guide-flow">
          <span>Profile facts</span>
          <b>→</b>
          <span>Fit score</span>
          <b>→</b>
          <span>Reviewed documents</span>
          <b>→</b>
          <span>You submit</span>
        </div>
        <Empty title="Advanced features are optional">
          Job boards, Gmail, the browser extension, analytics, and LaTeX templates can be configured later from the
          secondary navigation.
        </Empty>
      </section>
    </>
  );
}
