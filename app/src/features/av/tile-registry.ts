// The video elements the call's tiles show (spec 041; design docs/design/session-recording-and-broadcast.md 4.4). Each camera
// tile registers its <video> while it is mounted, so the recorder's compositor draws what this window shows without reaching
// into the DOM. One registry per document: the call window is a single persistent mount.

export interface TileVideo {
  participantId: string;
  el: HTMLVideoElement;
}

const tiles: TileVideo[] = [];

/** Register a tile's video element; returns the unregister. */
export function registerTileVideo(participantId: string, el: HTMLVideoElement): () => void {
  const entry: TileVideo = { participantId, el };
  tiles.push(entry);
  return () => {
    const i = tiles.indexOf(entry);
    if (i >= 0) tiles.splice(i, 1);
  };
}

/** The registered tiles, in the order they mounted. */
export function tileVideos(): TileVideo[] {
  return [...tiles];
}
