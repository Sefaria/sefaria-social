import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FeedPage } from "./FeedPage";

describe("FeedPage placeholder", () => {
  // @ac 000/AC-001
  it("shows the surface name, its id and the SurfaceHost contract version it was built for", () => {
    expect(renderToStaticMarkup(<FeedPage />)).toBe(
      "<main><h1>Sefaria Social</h1><p>Surface: social, SurfaceHost contract v1.0</p></main>",
    );
  });
});
