import type { ReactNode } from "react";
import { CONTRACT_VERSION, SURFACE } from "~/lib/surface-info";

/**
 * The page at `/social` (plan R6): the surface's name and the SurfaceHost contract version it was built for (spec 000, a
 * diagnostic line for developers), then the feed (spec 015) as children.
 */
export function FeedPage({ children }: { children?: ReactNode }) {
  return (
    <main>
      <h1>{SURFACE.name}</h1>
      <p>{`Surface: ${SURFACE.id}, SurfaceHost contract v${CONTRACT_VERSION}`}</p>
      {children}
    </main>
  );
}
