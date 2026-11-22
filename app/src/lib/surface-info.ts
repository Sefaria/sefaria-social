/**
 * Who this surface is and which SurfaceHost contract it was built for (docs/CONTRACT.md). Defined once; P1 derives the
 * version from the pinned contract in packages/host-contract.
 */
export const SURFACE = {
  id: "social",
  name: "Sefaria Social",
  contract: { major: 1, minor: 0 },
} as const;

/** "major.minor" of the SurfaceHost contract, e.g. "1.0". */
export const CONTRACT_VERSION = `${SURFACE.contract.major}.${SURFACE.contract.minor}`;
