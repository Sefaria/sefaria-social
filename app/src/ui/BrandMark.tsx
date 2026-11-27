import type { HTMLAttributes } from "react";
import brand from "./brand.module.css";

/**
 * The Sefaria Social mark (a page with two cursors, teal and gold: two learners on one text) and the byline "from Sefaria Labs"
 * (spec 060, preview). The mark is decorative; the byline is the text. `lang` and `dir` come from the caller's language.
 */
export function BrandMark({ byline, ...lang }: { byline: string } & Pick<HTMLAttributes<HTMLElement>, "lang" | "dir">) {
  return (
    <span className={brand.mark} data-labs-brand="" {...lang}>
      <svg viewBox="0 0 64 64" width="22" height="22" aria-hidden="true" focusable="false">
        <g fill="none" strokeLinecap="round" strokeWidth="5">
          <rect x="6" y="6" width="52" height="52" rx="12" stroke="currentColor" />
          <path d="M17 21H35M17 32H47M17 43H29" stroke="currentColor" />
          <path d="M41 16V26" stroke="var(--labs-live)" data-cursor="" />
          <path d="M35 38V48" stroke="var(--labs-gold)" data-cursor="" />
        </g>
      </svg>
      {byline}
    </span>
  );
}
