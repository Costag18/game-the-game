// Curated list of police bodycam YouTube video IDs.
// Sourced from the @MidwestSafety and @EWUBodycam channels.
// The server picks one at random per tournament — add/remove freely.
export const POLICE_BODYCAM_VIDEOS = [
  // --- @MidwestSafety ---
  '5ES3XcWcazA',
  '5yVY03RELfY',
  '6DtgEuXrNio',
  '7wG5JbpIOu8',
  '7zA52hzfWNs',
  '9BJ04n1JxA0',
  'DVPN_ZVf6tc',
  'DYJGe4GVYpE',
  'D_YvPUQuzPA',
  'NUIK3SZUIXk',
  'RUagl05TGOA',
  'SdTUl0WPGG8',
  'XCgzH1YOmGI',
  'XQIPEn07diQ',
  'XYJ7GIK_tHs',
  'Xj9qCCBx2wE',
  'XtbuSlZLcJw',
  'ZYeOioyar0E',
  'Zy2RjrkMMSM',
  'coGWcqAiZYE',
  'evRLcrGvDCM',
  'eyRlXZGvKSU',
  'lEe7HB-n7Q0',
  'lh182auwE5M',
  'p0pTKXp84zI',
  'qRttCDR1rd0',
  'rYx19sFTy8g',
  'tOv4IZ9zBzM',
  'vmmpnGAHCmA',
  'xg9KncyKZUY',
  // --- @EWUBodycam ---
  '-mE3CzjVsSI',
  '1OpNwX89q3g',
  '3LxlKGj5vf8',
  '6pbl9MuQgY4',
  'Bo89JGTdjPg',
  'CbuYkTpl3g0',
  'ENa85XJlZA0',
  'HgWjtNfyMeY',
  'JNBaNTMhjx4',
  'LZLNej74CZ8',
  'TOw0fwKng_I',
  'V2JSPkogLwU',
  'XaMEqvmOhvE',
  'XciW8A9LYuI',
  '_1_JZe210uo',
  'ci3VywUb_ks',
  'daZJIs7qGYs',
  'eIsVCvAyCWk',
  'eS7Zo-NgeqA',
  'elVsNXl2d-A',
  'mj-03iyidgs',
  'nS1o3yEiB7c',
  'ntTvm-8cHUQ',
  'odi2fp_cNvE',
  'px13ibaIE1E',
  'utVvVQF3Qmo',
  'vE9IoSoujUc',
  'wAYjPPE0YMo',
  'wJbK0YamaSU',
  'yy-c7XKEarg',
];

export function pickRandomBodycamVideo(excludeId = null) {
  const pool = excludeId
    ? POLICE_BODYCAM_VIDEOS.filter((id) => id !== excludeId)
    : POLICE_BODYCAM_VIDEOS;
  if (pool.length === 0) return POLICE_BODYCAM_VIDEOS[0];
  return pool[Math.floor(Math.random() * pool.length)];
}
