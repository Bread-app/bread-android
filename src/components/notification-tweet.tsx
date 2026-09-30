import React, { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { getTweetOembed, type TweetOembedData } from '@/lib/api';
import { useThemeStore } from '@/lib/theme-store';

export function NotificationTweet({ url, compact = false }: { url: string; compact?: boolean }) {
  const { colors } = useThemeStore();
  const [post, setPost] = useState<TweetOembedData | null>(null);
  const valid = /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/]+\/status\/\d+(?:[/?#].*)?$/.test(url);
  useEffect(() => {
    let active = true;
    setPost(null);
    if (valid) void getTweetOembed(url).then(value => { if (active) setPost(value); }).catch(() => {});
    return () => { active = false; };
  }, [url, valid]);
  if (!valid) return null;
  return <Pressable accessibilityRole="link" accessibilityLabel="Open source post on X" onPress={() => void Linking.openURL(url)}>
    <View style={{ margin: 16, padding: 14, borderRadius: 14, backgroundColor: colors.surfaceAlt, gap: 6 }}>
      <Text style={{ color: colors.text, fontWeight: '700' }}>{post ? `${post.authorName} · @${post.authorHandle.replace(/^@/, '')}` : 'View source post on X'}</Text>
      {post ? <Text numberOfLines={compact ? 2 : undefined} style={{ color: colors.text, lineHeight: 20 }}>{post.text}</Text> : null}
    </View>
  </Pressable>;
}
