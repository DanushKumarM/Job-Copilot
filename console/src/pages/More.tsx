import { Link } from "react-router-dom";
import { PageHeader } from "../ui";

// Phone layout only: the tab bar has room for four sections, the rest live here.
export default function MorePage() {
  return (
    <>
      <PageHeader title="More" />
      <nav className="card more-list">
        <Link to="/sources">Job boards</Link>
        <Link to="/insights">Insights</Link>
        <Link to="/settings">Settings</Link>
      </nav>
    </>
  );
}
