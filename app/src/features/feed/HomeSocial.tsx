// The social half of the home page (specs 023, 025), a separate chunk so the reader downloads it only when /social opens with
// someone signed in (the surface's size budget, spec 019).
import { useState } from "react";
import type { Post } from "~/features/api/social-api";
import { Composer } from "~/features/post/Composer";
import { Timeline } from "~/features/post/Timeline";
import { WhoToFollow } from "~/features/profile/WhoToFollow";

export function HomeColumn() {
  const [latest, setLatest] = useState<Post | null>(null);
  return (
    <>
      <Composer onPosted={setLatest} />
      <Timeline latest={latest} />
    </>
  );
}

export { WhoToFollow };
