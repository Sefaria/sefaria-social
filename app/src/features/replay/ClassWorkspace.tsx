import { useId, useState } from "react";
import { useInterfaceLang } from "~/features/host/host-context";
import { ReaderRefLink } from "~/features/host/ReaderRefLink";
import { useStrings } from "~/features/shell/use-strings";
import { SourceText } from "~/ui/SourceText";
import type { AssetManifest } from "./replay-api";
import styles from "./recording-artifacts.module.css";

export function ClassWorkspace({
  sources,
  selected,
  onSelect,
}: {
  sources: NonNullable<AssetManifest["chapters"]>;
  selected: number;
  onSelect: (index: number) => void;
}) {
  const t = useStrings();
  const lang = useInterfaceLang();
  const id = useId();
  const [language, setLanguage] = useState("both");
  const current = sources[selected] ?? sources[0];
  if (!current) return <p>{t.shiurNoTexts}</p>;
  return (
    <>
      <div className={styles.workspaceTools}>
        <label htmlFor={`${id}-source`}>
          {t.shiurChooseSource}
          <select id={`${id}-source`} value={selected} onChange={(event) => onSelect(Number(event.target.value))}>
            {sources.map((source, index) => (
              <option value={index} key={source.ref}>
                {index + 1}. {lang === "hebrew" ? source.heRef || source.ref : source.ref}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-lang`}>
          {t.shiurTextLanguage}
          <select id={`${id}-lang`} value={language} onChange={(event) => setLanguage(event.target.value)}>
            <option value="both">{t.shiurBilingual}</option>
            <option value="he">עברית</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>
      <div className={styles.workspace}>
        <article className={styles.reading} data-text-language={language}>
          <p className={styles.eyebrow}>{t.shiurSourceExcerpt}</p>
          <h3 data-reading-ref="">
            <bdi>{lang === "hebrew" ? current.heRef || current.ref : current.ref}</bdi>
          </h3>
          <SourceText key={current.ref} textRef={current.ref} interfaceLang={lang} unavailableLabel={t.shiurTextUnavailable} />
          <ReaderRefLink textRef={current.ref} beside>
            {t.shiurOpenReader} ↗
          </ReaderRefLink>
        </article>
        <aside className={styles.margins} aria-label={t.shiurSharedMargins}>
          <p className={styles.eyebrow}>{t.shiurSharedReading}</p>
          <h3>{t.shiurSharedMargins}</h3>
          <p>{t.shiurNoAnnotations}</p>
          <p className={styles.muted}>{t.shiurMarginsHint}</p>
        </aside>
      </div>
      <div className={styles.workspaceTools}>
        <button type="button" disabled={selected === 0} onClick={() => onSelect(selected - 1)}>
          {t.shiurPrevious}
        </button>
        <span aria-live="polite">
          {selected + 1} / {sources.length}
        </span>
        <button
          data-next-source=""
          type="button"
          disabled={selected >= sources.length - 1}
          onClick={() => onSelect(selected + 1)}
        >
          {t.shiurNext}
        </button>
      </div>
    </>
  );
}
