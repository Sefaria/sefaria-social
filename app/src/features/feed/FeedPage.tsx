import { CONTRACT_VERSION, SURFACE } from "~/lib/surface-info";

/** Placeholder for the feed page at `/social` (plan R6). Replaced when the feed spec is built. */
export function FeedPage() {
  return (
    <main>
      <h1>{SURFACE.name}</h1>
      <p>{`Surface: ${SURFACE.id}, SurfaceHost contract v${CONTRACT_VERSION}`}</p>
    </main>
  );
}
