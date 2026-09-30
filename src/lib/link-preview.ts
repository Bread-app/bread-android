/**
 * Recognises the two source links Bread understands — a YouTube video and an
 * X/Twitter status — from arbitrary text.
 *
 * Lives in `lib/` rather than next to the composer that first used it because
 * the FEED needs it too: `getSourceVideo` resolves a sandwich's video from its
 * source URL, and that runs for every card. Keeping it here is what lets
 * `lib/sandwich-feed.ts` stay a leaf module with no screen imports.
 */
export type LinkPreviewType = "youtube" | "twitter";

export type LinkPreview = {
  type: LinkPreviewType;
  url: string;
  // YouTube
  videoId?: string;
  // Twitter/X
  tweetId?: string;
  statusPath?: string;
};

export function detectLinkPreview(text: string): LinkPreview | null {
  // YouTube: youtube.com/watch?v=ID or youtu.be/ID
  const ytMatch =
    text.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,15})/) ||
    text.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{6,15})/);
  if (ytMatch) {
    const videoId = ytMatch[1];
    return { type: "youtube", url: `https://www.youtube.com/watch?v=${videoId}`, videoId };
  }
  // X / Twitter: x.com/user/status/ID or twitter.com/user/status/ID
  const twMatch = text.match(
    /(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)\/status\/(\d{1,25})/,
  );
  if (twMatch) {
    const statusPath = `${twMatch[1]}/status/${twMatch[2]}`;
    const tweetId = twMatch[2];
    return {
      type: "twitter",
      url: `https://x.com/${statusPath}`,
      tweetId,
      statusPath,
    };
  }
  return null;
}
