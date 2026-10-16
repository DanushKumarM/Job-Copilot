import { api, setToken } from "../api";
import { Badge, Button, ErrorBox, Loading, PageHeader, useLoad } from "../ui";

export default function SettingsPage() {
  const { data, error, reload } = useLoad(api.status);
  return (
    <>
      <PageHeader title="Settings" subtitle="Configured in backend/.env; shown here so you can check what is in effect." />
      {error && <ErrorBox error={error} retry={reload} />}
      {!data && !error && <Loading />}
      {data && (
        <section className="card">
          <dl className="settings">
            <dt>Content writer</dt>
            <dd>
              {data.llm_provider === "ollama" ? "Ollama on this machine" : "Hosted model"} · <code>{data.llm_model}</code>
            </dd>
            <dt>Requirement extraction</dt>
            <dd>
              {data.requirement_extractor === "llm"
                ? `Model (${data.extraction_provider}), checked against the description`
                : "Rules (set JOBCOPILOT_REQUIREMENT_EXTRACTOR=llm to refine with a model)"}
            </dd>
            <dt>Gmail</dt>
            <dd>
              {data.gmail_connected ? <Badge tone="ok">connected, read-only</Badge> : <Badge tone="warn">not connected</Badge>}
            </dd>
          </dl>
        </section>
      )}
      <section className="card">
        <h2>Browser extension</h2>
        <p className="small">
          Load <code>extension/dist</code> in Chrome (<code>chrome://extensions</code> → Developer mode → Load unpacked),
          then open its options and enter this server's address (<code>{window.location.origin}</code>) and the same
          access token you signed in with.
        </p>
      </section>
      <section className="card">
        <h2>This browser</h2>
        <p className="small subtle">Signing out clears this browser session.</p>
        <Button
          variant="danger"
          onClick={async () => {
            try {
              await api.logout();
            } finally {
              setToken(null);
            }
          }}
        >
          Sign out
        </Button>
      </section>
    </>
  );
}
