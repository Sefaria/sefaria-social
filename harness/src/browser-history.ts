// The fake host's history in the harness: the browser's own. Here the harness plays the reader, and the reader owns the
// address bar, so Back, Forward, reloads and deep links behave as they will in the real page. Like the reader, it keeps the
// surface's state under its own key in each entry (host.location.get().state is only the surface's part).
import type { FakeHistory } from "@sefaria-social/host-contract/fake-host";

export function createBrowserFakeHistory(): FakeHistory {
  const subs = new Set<() => void>();
  const emit = () => subs.forEach((cb) => cb());
  window.addEventListener("popstate", emit);
  const surfaceState = () => (window.history.state as { surface?: unknown } | null)?.surface ?? null;
  return {
    get: () => ({
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      state: surfaceState(),
    }),
    push(path, state) {
      window.history.pushState({ surface: state }, "", path);
      emit();
    },
    replace(path, state) {
      window.history.replaceState({ surface: state }, "", path);
      emit();
    },
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
