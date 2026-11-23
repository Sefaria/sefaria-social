// What both route trees share (docs/decisions/0003-two-builds.md): the path grammar of routing rule R6, the search validation
// of R7 and the id guard. The Start app's file routes (app/src/routes) and the surface's code-based tree
// (app/src/surface/route-tree.tsx) are two thin trees over these definitions and the same page components.
import { notFound } from "@tanstack/react-router";
import { z } from "zod";
import { isId } from "~/lib/ids";

/**
 * R6. Every path is under /social (R2); anything else under /social is social's not-found page. Posts, profiles and the
 * activity page joined the grammar with specs 023, 025 and 026.
 */
export const SOCIAL_PATHS = {
  feed: "/social/",
  room: "/social/r/$roomId",
  shiur: "/social/s/$shiurId",
  post: "/social/p/$postId",
  profile: "/social/u/$profileId",
  notifications: "/social/notifications",
  settings: "/social/settings",
  notFound: "/social/$",
} as const;

/** R6: an id that does not match the relay's rule renders social's not-found page, not an error. */
export function requireId(value: string): void {
  if (!isId(value)) throw notFound();
}

/** R7: a page without search parameters drops whatever arrives. */
export const validateNoSearch = (_raw: Record<string, unknown>): Record<string, never> => ({});

export const SETTINGS_TABS = ["profile", "notifications"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
const settingsSearchSchema = z.object({ tab: z.enum(SETTINGS_TABS).optional() });
export type SettingsSearch = z.infer<typeof settingsSearchSchema>;

/** R7: `/social/settings?tab=…`. Unknown parameters are dropped; an unknown tab is dropped too. */
export function validateSettingsSearch(raw: Record<string, unknown>): SettingsSearch {
  const parsed = settingsSearchSchema.safeParse({ tab: raw.tab });
  return parsed.success ? parsed.data : {};
}
