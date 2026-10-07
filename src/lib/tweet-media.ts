import { useEffect, useState } from "react";

/**
 * The visuals attached to an X post — its photos (or a video's poster) and the
 * link card, when the tweet unfurled one.
 *
 * The backend stores only a tweet's text, so the feed reads these from X's
 * public embed endpoint (the one embedded tweets and `react-tweet` use). No
 * auth; one small request per tweet, cached for the session.
 */
export type TweetPhoto = {
  url: string;
  width: number;
  height: number;
  /** A video or GIF: `url` is its poster frame. */
  isVideo: boolean;
};

export type TweetLinkCard = {
  imageUrl: string;
  title: string | null;
  domain: string | null;
  url: string | null;
  /** `summary` cards unfurl as a small square thumb, not a banner. */
  large: boolean;
};

export type TweetMedia = {
  photos: TweetPhoto[];
  card: TweetLinkCard | null;
  /** t.co links that only stand in for the media above — drop them from the text. */
  hiddenUrls: string[];
};

const EMPTY: TweetMedia = { photos: [], card: null, hiddenUrls: [] };

const cache = new Map<string, TweetMedia>();
const inflight = new Map<string, Promise<TweetMedia>>();

export function tweetIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/(?:x|twitter)\.com\/[^/]+\/status(?:es)?\/(\d+)/i);
  return match?.[1] ?? null;
}

/** The token the embed endpoint expects, derived from the id the same way X's widget does. */
function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(6 ** 2).replace(/(0+|\.)/g, "");
}

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

function parse(payload: unknown): TweetMedia {
  if (!isRecord(payload)) return EMPTY;
  const hiddenUrls: string[] = [];

  const photos: TweetPhoto[] = [];
  const mediaDetails = Array.isArray(payload.mediaDetails) ? payload.mediaDetails : [];
  for (const media of mediaDetails) {
    if (!isRecord(media)) continue;
    const url = str(media.media_url_https);
    if (!url) continue;
    const info = isRecord(media.original_info) ? media.original_info : {};
    photos.push({
      url,
      width: typeof info.width === "number" ? info.width : 16,
      height: typeof info.height === "number" ? info.height : 9,
      isVideo: media.type === "video" || media.type === "animated_gif",
    });
    const tco = str(media.url);
    if (tco) hiddenUrls.push(tco);
  }

  let card: TweetLinkCard | null = null;
  const rawCard = isRecord(payload.card) ? payload.card : null;
  // A tweet with its own photos never shows the link card on X either.
  if (rawCard && photos.length === 0) {
    const values = isRecord(rawCard.binding_values) ? rawCard.binding_values : {};
    const image = (key: string) => {
      const entry = values[key];
      return isRecord(entry) && isRecord(entry.image_value) ? str(entry.image_value.url) : null;
    };
    const text = (key: string) => {
      const entry = values[key];
      return isRecord(entry) ? str(entry.string_value) : null;
    };
    const imageUrl =
      image("photo_image_full_size_large") ??
      image("thumbnail_image_large") ??
      image("summary_photo_image_large") ??
      image("thumbnail_image");
    if (imageUrl) {
      card = {
        imageUrl,
        title: text("title"),
        domain: text("vanity_url") ?? text("domain"),
        url: text("card_url") ?? str(rawCard.url),
        large: str(rawCard.name) !== "summary",
      };
      const tco = str(rawCard.url);
      if (tco) hiddenUrls.push(tco);
    }
  }

  return { photos: photos.slice(0, 4), card, hiddenUrls };
}

function loadTweetMedia(id: string): Promise<TweetMedia> {
  const existing = inflight.get(id);
  if (existing) return existing;
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${syndicationToken(id)}`;
  const request = fetch(url)
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => parse(payload))
    // A deleted or protected tweet just renders without media.
    .catch(() => EMPTY)
    .then((media) => {
      cache.set(id, media);
      inflight.delete(id);
      return media;
    });
  inflight.set(id, request);
  return request;
}

/** Media for the X post at `sourceUrl`; empty until loaded and for non-X sources. */
export function useTweetMedia(sourceUrl: string | null | undefined): TweetMedia {
  const id = tweetIdFromUrl(sourceUrl);
  const [media, setMedia] = useState<TweetMedia>(() => (id ? cache.get(id) : null) ?? EMPTY);

  useEffect(() => {
    if (!id) {
      setMedia(EMPTY);
      return;
    }
    const cached = cache.get(id);
    if (cached) {
      setMedia(cached);
      return;
    }
    let live = true;
    void loadTweetMedia(id).then((loaded) => {
      if (live) setMedia(loaded);
    });
    return () => {
      live = false;
    };
  }, [id]);

  return media;
}

/** The text with the media's stand-in t.co links removed. */
export function stripHiddenUrls(text: string, hiddenUrls: string[]): string {
  if (hiddenUrls.length === 0) return text;
  let out = text;
  for (const url of hiddenUrls) out = out.split(url).join("");
  return out.replace(/[ \t]+\n/g, "\n").trim();
}
