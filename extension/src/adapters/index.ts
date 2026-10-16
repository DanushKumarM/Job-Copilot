import { type Adapter } from "./fill";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";

export function adapterFor(url: URL): Adapter | null {
  if (url.hostname.endsWith("greenhouse.io")) return greenhouse;
  if (url.hostname === "jobs.lever.co") return lever;
  return null;
}

export { greenhouse, lever };
