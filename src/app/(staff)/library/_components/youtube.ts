/** Extract a YouTube video ID from common URL shapes:
 *    youtube.com/watch?v=<id>
 *    youtu.be/<id>
 *    youtube.com/embed/<id>
 *    youtube.com/shorts/<id>
 *  Returns null for any other URL (private videos, non-YouTube hosts,
 *  malformed input). The library card renders the canonical thumbnail
 *  (img.youtube.com/vi/<id>/mqdefault.jpg) when the ID resolves; otherwise
 *  it falls back to the solid Play-icon block. */
const YOUTUBE_ID_RE =
  /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/

export function getYoutubeThumbnailUrl(videoUrl: string | null): string | null {
  if (!videoUrl) return null
  const match = videoUrl.match(YOUTUBE_ID_RE)
  if (!match) return null
  return `https://img.youtube.com/vi/${match[1]}/mqdefault.jpg`
}
