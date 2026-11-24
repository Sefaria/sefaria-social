// The "For you" ranking (spec 031), modelled on X's open-source home timeline (github.com/twitter/the-algorithm and
// the-algorithm-ml). X's heavy ranker predicts, for one viewer and one post, the probability of each engagement and adds
// them up with fixed weights:  score = Σ weight(a) × P(a).  Then home-mixer rescales: out-of-network posts × 0.75, and a
// listwise pass spreads authors out. We have no trained model and a small community, so P(a) is estimated from what the
// post has actually drawn, smoothed toward a prior and personalised by how much the viewer engages with the author.
//
// Taken from X's published code (the-algorithm-ml projects/home/recap/README.md, "April 5, 2023"; home-mixer
// OONTweetScalingScorer.scala):  fav 0.5, retweet 1.0, reply 13.5, reply_engaged_by_author 75.0, negative_feedback_v2 -74.0,
// report -369.0, out-of-network scale 0.75 (not applied to a post that reached the viewer through a repost).
// Our own choices, where X publishes no number we can use: the quote weight (X scores quotes as their own action; we put it
// just under a reply), the priors and smoothing, the affinity boost, a 24-hour half-life from the post's latest boost (a new
// repost or quote gives it a second wind), and author diversity (each further post by the same author in one page × 0.5, down
// to × 0.25). Heads with no signal here (good_click, good_profile_click, video_playback50) are left out; negative feedback
// and reports have weights but nothing in the product records them yet.
//
// The pipeline mirrors home-mixer's stages: sources (candidates) → hydrate (features) → score → rescore (out-of-network,
// diversity) → select (page).

/** X's published heavy-ranker weights, plus our quote weight. */
export const WEIGHTS = {
  fav: 0.5,
  repost: 1.0,
  quote: 12.5,
  reply: 13.5,
  replyEngagedByAuthor: 75.0,
  negativeFeedback: -74.0,
  report: -369.0,
} as const;

/** home-mixer OONTweetScalingScorer: ScaleFactor = 0.75. */
export const OUT_OF_NETWORK_SCALE = 0.75;

/** Our choices (see the header). */
export const TUNING = {
  /** Pseudo-audience for smoothing: a post with no followers behind it still gets a fair estimate. */
  smoothing: 10,
  /** Prior engagement rates (per viewer who sees the post), used before a post has drawn anything. */
  prior: { fav: 0.08, repost: 0.01, quote: 0.004, reply: 0.02, replyEngagedByAuthor: 0.004, negativeFeedback: 0, report: 0 },
  /** Hours for a post's score to halve, counted from its latest boost (posted, reposted or quoted). */
  halfLifeHours: 24,
  /** Each of the viewer's recent engagements with an author lifts that author's posts: 1 + 0.5 × ln(1 + n). */
  affinityStrength: 0.5,
  /** Author diversity: the nth further post by one author in a page is multiplied by max(decay^n, floor). */
  diversityDecay: 0.5,
  diversityFloor: 0.25,
} as const;

export type Engagement = keyof typeof WEIGHTS;

/** What the ranker knows about one candidate post for one viewer. */
export interface Candidate {
  postId: string;
  authorProfileId: string;
  createdAt: Date;
  /** The latest repost or quote of it, if any (a second wind). */
  boostedAt: Date | null;
  /** How many each engagement it has drawn. */
  counts: Record<Engagement, number>;
  /** Followers of its author: the audience it was shown to. */
  audience: number;
  /** The viewer follows the author, or is the author. */
  inNetwork: boolean;
  /** A profile the viewer follows reposted it (X does not scale these down). */
  viaNetworkRepost: boolean;
  /** The viewer's engagements with this author's posts in the last 30 days. */
  affinity: number;
}

export interface Scored {
  postId: string;
  authorProfileId: string;
  score: number;
  /** The parts of the score, for tests and debugging. */
  parts: { engagement: number; personal: number; decay: number; network: number; diversity: number };
}

/** P(a): what the post has drawn per viewer, smoothed toward the prior. */
export function probability(c: Candidate, a: Engagement): number {
  const engaged = Math.max(c.counts.fav, c.counts.reply, c.counts.repost, c.counts.quote);
  const reach = Math.max(c.audience, engaged) + TUNING.smoothing;
  return (c.counts[a] + TUNING.prior[a] * TUNING.smoothing) / reach;
}

/** Σ weight(a) × P(a), X's heavy-ranker sum. */
export function engagementScore(c: Candidate): number {
  return (Object.keys(WEIGHTS) as Engagement[]).reduce((sum, a) => sum + WEIGHTS[a] * probability(c, a), 0);
}

export function decay(c: Candidate, now: Date): number {
  const since = Math.max(c.createdAt.getTime(), c.boostedAt?.getTime() ?? 0);
  const hours = Math.max(0, (now.getTime() - since) / 3_600_000);
  return 0.5 ** (hours / TUNING.halfLifeHours);
}

/** Score every candidate on its own (X scores candidates independently), then rescore the list for author diversity. */
export function rank(candidates: Candidate[], now: Date = new Date()): Scored[] {
  const scored = candidates.map((c) => {
    const engagement = engagementScore(c);
    const personal = 1 + TUNING.affinityStrength * Math.log1p(c.affinity);
    const d = decay(c, now);
    const network = c.inNetwork || c.viaNetworkRepost ? 1 : OUT_OF_NETWORK_SCALE;
    return {
      postId: c.postId,
      authorProfileId: c.authorProfileId,
      score: engagement * personal * d * network,
      parts: { engagement, personal, decay: d, network, diversity: 1 },
    };
  });
  return diversify(scored);
}

/** Greedy listwise rescoring: take the best, discount that author's remaining posts, repeat. */
export function diversify(scored: Scored[]): Scored[] {
  const left = [...scored];
  const seen = new Map<string, number>();
  const out: Scored[] = [];
  while (left.length) {
    let best = 0;
    let bestScore = -Infinity;
    left.forEach((s, i) => {
      const n = seen.get(s.authorProfileId) ?? 0;
      const v = s.score * Math.max(TUNING.diversityDecay ** n, TUNING.diversityFloor);
      // ties: newer id order is stable by input order (the caller passes newest first)
      if (v > bestScore) {
        bestScore = v;
        best = i;
      }
    });
    const [s] = left.splice(best, 1);
    const n = seen.get(s!.authorProfileId) ?? 0;
    const diversity = Math.max(TUNING.diversityDecay ** n, TUNING.diversityFloor);
    out.push({ ...s!, score: s!.score * diversity, parts: { ...s!.parts, diversity } });
    seen.set(s!.authorProfileId, n + 1);
  }
  return out;
}
