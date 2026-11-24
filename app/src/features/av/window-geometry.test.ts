// The call window's geometry (spec 035): placement, clamping, snapping, keyboard nudges and the saved position, as pure
// functions. Loaded through import.meta.glob so each test fails on an assertion where the module does not exist.
import { describe, expect, it } from "vitest";

const modules = import.meta.glob<typeof import("./window-geometry")>("./window-geometry.ts");
async function load() {
  const mod = await modules["./window-geometry.ts"]?.();
  expect(mod, "app/src/features/av/window-geometry.ts exists").toBeDefined();
  return mod!;
}

const VIEWPORT = { width: 1280, height: 900 };
const INSETS = { top: 60, inlineStart: 0, inlineEnd: 0, bottom: 0 };

describe("call window geometry", () => {
  // @feature SESS-060 Floating call window: place, move, resize
  // @ac 035/AC-002
  it("opens at the top inline-end corner, 16px inside the insets: right in English, left in Hebrew", async () => {
    const g = await load();
    const p = g.DEFAULT_PLACEMENT;
    expect(p).toMatchObject({ corner: "top-end", offsetX: 16, offsetY: 16, size: "small" });
    const dims = g.dimensions(p, VIEWPORT);
    const ltr = g.rect(p, dims, g.area(VIEWPORT, INSETS, "ltr"), "ltr");
    expect(ltr).toEqual({ left: 1280 - 16 - dims.width, top: 60 + 16, width: dims.width, height: dims.height });
    const rtl = g.rect(p, dims, g.area(VIEWPORT, INSETS, "rtl"), "rtl");
    expect(rtl).toMatchObject({ left: 16, top: 76 });
    // an inset at the inline end (the side panel) moves the default with it
    const withPanel = g.rect(p, dims, g.area(VIEWPORT, { ...INSETS, inlineEnd: 400 }, "ltr"), "ltr");
    expect(withPanel.left).toBe(1280 - 400 - 16 - dims.width);
    const withPanelRtl = g.rect(p, dims, g.area(VIEWPORT, { ...INSETS, inlineEnd: 400 }, "rtl"), "rtl");
    expect(withPanelRtl.left).toBe(400 + 16);
  });

  // @feature SESS-060 Floating call window: place, move, resize
  // @ac 035/AC-003
  it("gives each size its box: pill, small, medium, and large at most 60% of the viewport, with a 16:10 tile area", async () => {
    const g = await load();
    const d = (size: "pill" | "small" | "medium" | "large", viewport = VIEWPORT) =>
      g.dimensions({ ...g.DEFAULT_PLACEMENT, size }, viewport);
    expect(d("pill")).toEqual({ width: 240, height: 48 });
    expect(d("small").width).toBe(320);
    expect(d("small").height - g.CONTROLS_HEIGHT).toBe(200);
    expect(d("medium").width).toBe(480);
    expect(d("medium").height - g.CONTROLS_HEIGHT).toBe(300);
    const large = d("large");
    expect(large.width).toBeLessThanOrEqual(0.6 * VIEWPORT.width);
    expect(large.height).toBeLessThanOrEqual(0.6 * VIEWPORT.height);
    expect((large.height - g.CONTROLS_HEIGHT) / large.width).toBeCloseTo(10 / 16, 2);
    // a free width stays between small and large and keeps the ratio
    const free = (width: number) => g.dimensions({ ...g.DEFAULT_PLACEMENT, size: "custom", width }, VIEWPORT);
    expect(free(10).width).toBe(320);
    expect(free(5000).width).toBe(large.width);
    expect((free(400).height - g.CONTROLS_HEIGHT) / 400).toBeCloseTo(10 / 16, 2);
  });

  // @feature SESS-060 Floating call window: place, move, resize
  // @ac 035/AC-006
  it("keeps the whole window inside the viewport minus the insets, whatever the viewport, size or insets", async () => {
    const g = await load();
    const p = { ...g.DEFAULT_PLACEMENT, corner: "bottom-end" as const, offsetX: 16, offsetY: 16, size: "large" as const };
    for (const viewport of [VIEWPORT, { width: 700, height: 500 }, { width: 400, height: 300 }]) {
      for (const insets of [INSETS, { top: 60, inlineStart: 0, inlineEnd: 420, bottom: 30 }]) {
        for (const dir of ["ltr", "rtl"] as const) {
          const a = g.area(viewport, insets, dir);
          const r = g.rect(p, g.dimensions(p, viewport), a, dir);
          const label = JSON.stringify({ viewport, insets, dir });
          expect(r.left, label).toBeGreaterThanOrEqual(a.left);
          expect(r.top, label).toBeGreaterThanOrEqual(a.top);
          if (r.width <= a.right - a.left) expect(r.left + r.width, label).toBeLessThanOrEqual(a.right);
          if (r.height <= a.bottom - a.top) expect(r.top + r.height, label).toBeLessThanOrEqual(a.bottom);
        }
      }
    }
  });

  // @feature SESS-060 Floating call window: place, move, resize
  // @ac 035/AC-004
  it("snaps a released window to the nearest corner, 16px inside the insets", async () => {
    const g = await load();
    const a = g.area(VIEWPORT, INSETS, "ltr");
    const dims = g.dimensions(g.DEFAULT_PLACEMENT, VIEWPORT);
    // dropped just left of the centre, low down: bottom left, which is bottom-start in English and bottom-end in Hebrew
    const box = { left: 600 - dims.width, top: 700, ...dims };
    expect(g.snap(g.DEFAULT_PLACEMENT, box, a, "ltr")).toMatchObject({ corner: "bottom-start", offsetX: 16, offsetY: 16 });
    expect(g.snap(g.DEFAULT_PLACEMENT, box, g.area(VIEWPORT, INSETS, "rtl"), "rtl")).toMatchObject({ corner: "bottom-end" });
    expect(g.snap(g.DEFAULT_PLACEMENT, { left: 900, top: 100, ...dims }, a, "ltr")).toMatchObject({ corner: "top-end" });
  });

  // @feature SESS-061 Call window by keyboard and screen reader
  // @ac 035/AC-008
  it("nudges by physical arrows and keeps the corner, clamped to the area", async () => {
    const g = await load();
    const a = g.area(VIEWPORT, INSETS, "ltr");
    const p = g.DEFAULT_PLACEMENT;
    const dims = g.dimensions(p, VIEWPORT);
    const left = g.nudge(p, -16, 0, dims, a, "ltr");
    expect(left).toMatchObject({ corner: "top-end", offsetX: 32, offsetY: 16 });
    const down = g.nudge(left, 0, 64, dims, a, "ltr");
    expect(down).toMatchObject({ corner: "top-end", offsetX: 32, offsetY: 80 });
    // in Hebrew the top-end corner is on the left: ArrowLeft moves toward it
    const rtl = g.nudge(p, -16, 0, dims, g.area(VIEWPORT, INSETS, "rtl"), "rtl");
    expect(rtl).toMatchObject({ corner: "top-end", offsetX: 0 });
    // cannot leave the area
    expect(g.nudge(p, 0, -500, dims, a, "ltr").offsetY).toBe(0);
  });

  // @feature SESS-060 Floating call window: place, move, resize
  // @ac 035/AC-007
  it("restores the saved place and size, and falls back to the default when storage throws or holds garbage", async () => {
    const g = await load();
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const saved = { ...g.DEFAULT_PLACEMENT, corner: "bottom-start" as const, size: "medium" as const, offsetX: 40 };
    g.savePlacement(storage, saved);
    expect(g.loadPlacement(storage)).toEqual(saved);

    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(g.loadPlacement(throwing)).toEqual(g.DEFAULT_PLACEMENT);
    expect(() => g.savePlacement(throwing, saved)).not.toThrow();
    expect(g.loadPlacement(null)).toEqual(g.DEFAULT_PLACEMENT);
    for (const garbage of ["{", '{"v":2}', '{"v":1,"corner":"middle"}', '{"v":1,"corner":"top-end","offsetX":-5}', "null"]) {
      store.set(g.STORAGE_KEY, garbage);
      expect(g.loadPlacement(storage), garbage).toEqual(g.DEFAULT_PLACEMENT);
    }
  });
});
