// Social's own minimal source-text renderer (plan 4.5; spec 017). It stays in this one file until contract v1.1 gives the
// surface the reader's `renderSegment`; then this file is the one place to replace. It renders plain text only: the text
// source (lib/sefaria-text.ts) has already validated the answer and stripped any markup, and React escapes the rest.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { pageTextSource, type SourceTextData, type TextSource } from "~/lib/sefaria-text";
import styles from "./source-text.module.css";

/** Lets tests (and the standalone pages) provide the text source; the surface uses the page's one. */
export const TextSourceContext = createContext<TextSource | null>(null);

/** How far outside the viewport a card's text starts loading (spec 017 AC-003). */
export const NEAR_VIEWPORT = "200px";

/** True once `el` has come within NEAR_VIEWPORT of the viewport (and stays true). Without IntersectionObserver: at once. */
export function useNearViewport(ref: { current: Element | null }): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: NEAR_VIEWPORT },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, near]);
  return near;
}

type State = { kind: "waiting" } | { kind: "ready"; data: SourceTextData } | { kind: "unavailable" };

export interface SourceTextProps {
  textRef: string;
  /** The interface language decides which block comes first. */
  interfaceLang: "english" | "hebrew";
  /** The line shown when the text cannot be had, in the interface language. */
  unavailableLabel: string;
}

/** The first segments of `textRef` in Hebrew and English, each block with its own `lang` and `dir`. */
export function SourceText({ textRef, interfaceLang, unavailableLabel }: SourceTextProps) {
  const source = useContext(TextSourceContext) ?? pageTextSource();
  const box = useRef<HTMLDivElement>(null);
  const near = useNearViewport(box);
  const [state, setState] = useState<State>({ kind: "waiting" });

  useEffect(() => {
    if (!near) return;
    let live = true;
    source.get(textRef).then(
      (data) => live && setState(data.blocks.length ? { kind: "ready", data } : { kind: "unavailable" }),
      () => live && setState({ kind: "unavailable" }),
    );
    return () => {
      live = false;
    };
  }, [near, source, textRef]);

  const first = interfaceLang === "hebrew" ? "he" : "en";
  const all = state.kind === "ready" ? state.data.blocks : [];
  const blocks = [...all.filter((b) => b.lang === first), ...all.filter((b) => b.lang !== first)];
  return (
    <div ref={box} className={styles.text} data-source-text={state.kind}>
      {blocks.map((b) => (
        <p key={b.lang} lang={b.lang} dir={b.dir} className={b.lang === "he" ? styles.he : styles.en}>
          {b.segments.join(" ")}
        </p>
      ))}
      {state.kind === "unavailable" && <p className={styles.unavailable}>{unavailableLabel}</p>}
    </div>
  );
}
