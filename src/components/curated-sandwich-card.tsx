import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Fonts } from '@/constants/theme';
import { PressableScale } from '@/components/pressable-scale';
import type { CuratedSandwich } from '@/lib/api';

const F = Fonts.rounded;

type Props = {
  entry: CuratedSandwich;
  onPress: (entry: CuratedSandwich) => void;
};

export function CuratedSandwichCard({ entry, onPress }: Props) {
  const { sandwich } = entry;
  const displayTitle = entry.title ?? sandwich.name;
  const displaySubtitle = entry.subtitle ?? sandwich.summary;

  return (
    <PressableScale onPress={() => onPress(entry)} scaleTo={0.96} style={styles.card}>
      {/* Cover image or gradient fallback */}
      {entry.coverImageUrl ? (
        <Image source={{ uri: entry.coverImageUrl }} style={styles.cover} />
      ) : (
        <View style={styles.coverFallback} />
      )}

      {/* Overlay content */}
      <View style={styles.overlay}>
        {/* Badge */}
        <View style={styles.badge}>
          <View style={styles.badgeDot} />
          <Text style={styles.badgeText}>Featured</Text>
        </View>

        {/* Title */}
        <Text style={styles.title} numberOfLines={2}>
          {displayTitle}
        </Text>

        {/* Subtitle */}
        <Text style={styles.subtitle} numberOfLines={2}>
          {displaySubtitle}
        </Text>

        {/* Bottom row: holdings count */}
        <View style={styles.meta}>
          <Text style={styles.metaText}>
            {sandwich.legs.length} stock{sandwich.legs.length !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 260,
    height: 160,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#10223d',
    marginRight: 12,
  },
  cover: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  coverFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#10223d',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    // dark scrim so text is always legible over any cover image
    backgroundColor: 'rgba(0,0,0,0.52)',
    padding: 14,
    justifyContent: 'flex-end',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    marginBottom: 8,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#35F046',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: F,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  title: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: F,
    lineHeight: 20,
    marginBottom: 4,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    fontFamily: F,
    lineHeight: 15,
    marginBottom: 8,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontFamily: F,
  },
});
