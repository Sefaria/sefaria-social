import { Link } from "@tanstack/react-router";
import { useStrings } from "./use-strings";

/** Social's own not-found page (R6): anything under /social that is not a page of R6 renders this inside the surface. */
export function SocialNotFound() {
  const t = useStrings();
  return (
    <main data-social-page="not-found">
      <h1>{t.notFoundTitle}</h1>
      <p>{t.notFoundBody}</p>
      <Link to="/social">{t.backToFeed}</Link>
    </main>
  );
}
