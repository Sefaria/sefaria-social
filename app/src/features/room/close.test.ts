import { beforeEach, expect, it, vi } from "vitest";
import { createFakeHost } from "@sefaria-social/host-contract/fake-host";
import { closeSession } from "./close";

const mock = vi.hoisted(() => ({
  view: vi.fn(),
  stop: vi.fn(),
  close: vi.fn(),
  leave: vi.fn(),
  hostView: vi.fn(),
  end: vi.fn(),
}));
vi.mock("~/features/recording/recording-controller", () => ({ recordingControllerFor: () => mock }));
vi.mock("~/features/session/controller", () => ({ roomControllerFor: () => mock }));
vi.mock("~/features/broadcast/broadcast-controller", () => ({ broadcastControllerFor: () => mock }));
beforeEach(() => {
  vi.resetAllMocks();
  mock.view.mockReturnValue({ kind: "recording", roomId: "room" });
  mock.hostView.mockReturnValue({ kind: "idle" });
});
// @feature SHIUR-008 Revisit a finished shiur through its texts and transcript
// @ac 061/AC-005
it("finishes before closing and opens the saved recording after leaving", async () => {
  const fake = createFakeHost();
  const navigate = vi.spyOn(fake.host, "navigate");
  mock.stop.mockResolvedValue("saved-recording");
  await closeSession(fake.host, "room");
  expect(mock.close).toHaveBeenCalledWith("room");
  expect(mock.leave).toHaveBeenCalledWith("room");
  expect(navigate).toHaveBeenLastCalledWith("/social/rec/saved-recording");
  expect(mock.stop.mock.invocationCallOrder[0]).toBeLessThan(mock.close.mock.invocationCallOrder[0]!);
  expect(mock.leave.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0]!);
});
// @ac 061/AC-005
it("keeps the room open when recording finalization fails", async () => {
  const fake = createFakeHost();
  const navigate = vi.spyOn(fake.host, "navigate");
  mock.stop.mockResolvedValue(undefined);
  await closeSession(fake.host, "room");
  expect(mock.close).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
});
// @ac 061/AC-005
it("does not close during a concurrent finish", async () => {
  mock.view.mockReturnValue({ kind: "stopping", roomId: "room" });
  await closeSession(createFakeHost().host, "room");
  expect(mock.close).not.toHaveBeenCalled();
});
