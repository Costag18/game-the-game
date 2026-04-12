// Curated list of police bodycam YouTube video IDs.
// All videos must be police bodycam / dashcam footage.
// Feel free to add or remove IDs — the server picks one at random per tournament.
export const POLICE_BODYCAM_VIDEOS = [
  'b1WWpKEPyFI',
  'JjqzlqBpPEs',
  'KwQUChCvb4Q',
  'xuCn8ux2gbs',
  'Ld7YB-BS4qY',
  'uFcvpae8Y3Q',
  'SCyfOrKbUS4',
  'PpkI3E9nL-c',
  'f8FjYI9wqQs',
  'rcHl_kJrLbQ',
  'OjOUCjH1yTs',
  'yF5sIw-1Y1Q',
  'n6n4w0GzU-E',
  '3jG6TM8H5Lg',
  'aCDSj9ZGzgA',
];

export function pickRandomBodycamVideo(excludeId = null) {
  const pool = excludeId
    ? POLICE_BODYCAM_VIDEOS.filter((id) => id !== excludeId)
    : POLICE_BODYCAM_VIDEOS;
  if (pool.length === 0) return POLICE_BODYCAM_VIDEOS[0];
  return pool[Math.floor(Math.random() * pool.length)];
}
