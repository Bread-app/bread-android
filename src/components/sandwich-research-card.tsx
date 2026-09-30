import React, { useMemo } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { Fonts, type ThemeColors } from '@/constants/theme';
import type { SandwichResearch } from '@/lib/api';
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;

/**
 * What the basket was actually researched from: the findings, the dated
 * catalysts it pays on, what would falsify it, and the sources consulted.
 *
 * Renders nothing when there is no research — every sandwich built before the
 * research pass existed carries none, and the pass is allowed to fail, so its
 * absence is a normal state rather than an error to announce.
 *
 * Styling deliberately mirrors sandwich-leg-card: same rounded-font labels,
 * same body face and line height, so a detail screen reads as one document.
 */
type SandwichResearchCardProps = {
  research: SandwichResearch | null;
  colors: ThemeColors;
};

/** "2026-09-04" → "Sep 4". Undated catalysts render without a chip at all. */
function formatCatalystDate(iso: string): string | null {
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function hostname(url: string): string {
  const match = /^https?:\/\/([^/]+)/i.exec(url);
  return match ? match[1].replace(/^www\./i, '') : url;
}

export function SandwichResearchCard({ research, colors }: SandwichResearchCardProps) {
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (!research) return null;

  const { summary, mechanism, catalysts, falsifiers, citations } = research;

  return (
    <View style={styles.card}>
      <Text style={styles.sectionLabel}>RESEARCH</Text>

      {summary ? <Text style={styles.body}>{summary}</Text> : null}
      {mechanism ? <Text style={styles.body}>{mechanism}</Text> : null}

      {catalysts.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.blockLabel}>CATALYSTS</Text>
          {catalysts.map((catalyst) => {
            const date = catalyst.date ? formatCatalystDate(catalyst.date) : null;
            return (
              <View key={`${catalyst.label}-${catalyst.date ?? 'undated'}`} style={styles.row}>
                <Text style={styles.rowText}>{catalyst.label}</Text>
                {/* No chip when undated: research is instructed never to
                    estimate a date, so an absent one must stay absent. */}
                {date ? (
                  <View style={styles.datePill}>
                    <Text style={styles.dateText}>{date}</Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {falsifiers.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.blockLabel}>WOULD FALSIFY THIS</Text>
          {falsifiers.map((falsifier) => (
            <View key={falsifier} style={styles.row}>
              <Text style={styles.rowText}>{falsifier}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {citations.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.blockLabel}>SOURCES</Text>
          <View style={styles.sourceWrap}>
            {citations.map((citation) => (
              <PressableScale
                key={citation.url}
                accessibilityRole="link"
                accessibilityLabel={citation.title ?? hostname(citation.url)}
                onPress={() => {
                  void Linking.openURL(citation.url).catch(() => {});
                }}
                hitSlop={8}
                style={styles.sourcePill}
              >
                <Text numberOfLines={1} style={styles.sourceText}>
                  {citation.title ?? hostname(citation.url)}
                </Text>
              </PressableScale>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    card: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 12,
      gap: 12,
    },
    sectionLabel: {
      fontFamily: F,
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 1.1,
      color: c.textSecondary,
    },
    body: {
      fontFamily: Fonts.poppins,
      fontSize: 15,
      lineHeight: 22,
      color: c.text,
    },
    block: {
      gap: 6,
    },
    blockLabel: {
      fontFamily: F,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 1,
      color: c.textSecondary,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    rowText: {
      flex: 1,
      fontFamily: Fonts.poppins,
      fontSize: 14,
      lineHeight: 20,
      color: c.text,
    },
    datePill: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: c.surfaceAlt,
    },
    dateText: {
      fontFamily: F,
      fontSize: 12,
      fontWeight: '700',
      color: c.textSecondary,
    },
    sourceWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    sourcePill: {
      maxWidth: '100%',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: c.surfaceAlt,
    },
    sourceText: {
      fontFamily: F,
      fontSize: 12,
      fontWeight: '700',
      color: c.accentBlue,
    },
  });
