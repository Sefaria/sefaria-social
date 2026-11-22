import { ReaderRefLink } from "~/features/host/ReaderRefLink";
import { useStrings } from "~/features/shell/use-strings";

/** `/social/s/$shiurId`: a shiur, scheduled, live or recorded (R6). A placeholder until the shiur specs. */
export function ShiurPage({ shiurId }: { shiurId: string }) {
  const t = useStrings();
  return (
    <main data-social-page="shiur">
      <h1>{t.shiur}</h1>
      <p>
        {t.shiurId}: <bdi>{shiurId}</bdi>
      </p>
      <p>{t.placeholder}</p>
      <p>
        <ReaderRefLink textRef="Genesis 1">{t.openText}</ReaderRefLink>
      </p>
    </main>
  );
}
