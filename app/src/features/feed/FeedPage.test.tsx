import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FeedPage } from "./FeedPage";

describe("FeedPage placeholder", () => {
  it("renders the page heading", () => {
    expect(renderToStaticMarkup(<FeedPage />)).toBe("<main><h1>Sefaria Social</h1></main>");
  });
});
