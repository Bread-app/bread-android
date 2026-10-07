import React from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;
const F_DISPLAY = Fonts.display;
const F_PERCENT = Fonts.displayMedium;
const F_MONO = Fonts.mono;

export const SHARE_CARD_POSITIVE = '#02ED45';
export const SHARE_CARD_NEGATIVE = '#FF1AB8';
export const SHARE_CARD_ACCENT = '#38BDF8';
const SHARE_CARD_INK = '#111827';
const SHARE_CARD_MUTED = '#747C8E';
const SHARE_CARD_BORDER = '#E5E7EE';
const SHARE_CARD_PANEL = '#F8F8FB';
const STAMP_HORIZONTAL_PERFORATIONS = Array.from({ length: 19 }, (_, index) => index);
const STAMP_VERTICAL_PERFORATIONS = Array.from({ length: 25 }, (_, index) => index);

export type SharePerformanceStat = {
  label: string;
  value: string;
};

export type ShareCardVariant = 'classic' | 'receipt';

export type SharePerformanceCardProps = {
  title: string;
  subtitle: string;
  iconUri?: string | null;
  iconFallback: string;
  dateLabel: string;
  chart: React.ReactNode;
  identityLabel: string;
  returnValue: string;
  returnDetail?: string | null;
  positive: boolean;
  returnColorOverride?: string;
  stats: readonly SharePerformanceStat[];
  footerLabel?: string;
  variant?: ShareCardVariant;
};

const SHARE_CARD_VARIANTS: readonly { value: ShareCardVariant; label: string }[] = [
  { value: 'classic', label: 'Card' },
  { value: 'receipt', label: 'Receipt' },
];

export function ShareCardVariantPicker({
  value,
  onChange,
}: {
  value: ShareCardVariant;
  onChange: (variant: ShareCardVariant) => void;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.variantPicker}>
      {SHARE_CARD_VARIANTS.map((option) => {
        const selected = option.value === value;
        return (
          <PressableScale
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${option.label} share design`}
            onPress={() => {
              if (!selected) onChange(option.value);
            }}
            style={[styles.variantButton, selected && styles.variantButtonSelected]}
          >
            <Text style={[styles.variantButtonText, selected && styles.variantButtonTextSelected]}>
              {option.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

export function SharePerformanceCard(props: SharePerformanceCardProps) {
  if (props.variant === 'receipt') return <ReceiptSharePerformanceCard {...props} />;
  return <ClassicSharePerformanceCard {...props} />;
}

/**
 * Fixed light social artifact shared by positions and sandwiches. Keeping the
 * canvas theme-independent makes the captured image predictable regardless of
 * the sender's app appearance setting.
 */
function ClassicSharePerformanceCard({
  title,
  subtitle,
  iconUri,
  iconFallback,
  dateLabel,
  chart,
  identityLabel,
  returnValue,
  returnDetail,
  positive,
  returnColorOverride,
  stats,
  footerLabel = 'breadapp.fun',
}: SharePerformanceCardProps) {
  const returnColor = returnColorOverride ?? (positive ? SHARE_CARD_POSITIVE : SHARE_CARD_NEGATIVE);

  return (
    <View style={styles.card}>
      <View style={styles.canvas}>
        <View style={styles.header}>
          {iconUri ? (
            <Image source={{ uri: iconUri }} style={styles.assetIcon} />
          ) : (
            <View style={[styles.assetIcon, styles.assetIconFallback]}>
              <Text style={styles.assetIconInitial}>{iconFallback.slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.assetCopy}>
            <Text style={styles.assetName} numberOfLines={1}>{title}</Text>
            <Text style={styles.assetSymbol} numberOfLines={1}>{subtitle}</Text>
          </View>
          <Text style={styles.date}>{dateLabel}</Text>
        </View>

        <View style={styles.chart} pointerEvents="none">
          {chart}
        </View>

        <View style={styles.performancePanel}>
          <View style={styles.identityRow}>
            <Image
              source={require('@/../assets/images/logo.png')}
              style={styles.identityLogo}
              resizeMode="contain"
            />
            <Text style={styles.identityText} numberOfLines={1}>{identityLabel}</Text>
          </View>

          <View style={styles.returnRow}>
            <Text
              style={[styles.returnValue, { color: returnColor }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.72}
            >
              {returnValue}
            </Text>
            {returnDetail ? (
              <Text style={[styles.returnDetail, { color: returnColor }]} numberOfLines={1}>
                {returnDetail}
              </Text>
            ) : null}
          </View>

          <View style={styles.statsRow}>
            {stats.slice(0, 3).map((stat, index) => (
              <View
                key={`${stat.label}-${index}`}
                style={[styles.stat, index > 0 && styles.statDivided]}
              >
                <Text style={styles.statLabel} numberOfLines={1}>{stat.label}</Text>
                <Text
                  style={styles.statValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.68}
                >
                  {stat.value}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        <View style={styles.footerBrand}>
          <Image
            source={require('@/../assets/images/logo.png')}
            style={styles.footerLogo}
            resizeMode="contain"
          />
          <View style={styles.footerWordmarkGlow}>
            <LinearGradient
              colors={[
                'rgba(255,255,255,0)',
                'rgba(255,255,255,0.28)',
                'rgba(255,255,255,0.4)',
                'rgba(255,255,255,0.28)',
                'rgba(255,255,255,0)',
              ]}
              locations={[0, 0.14, 0.5, 0.86, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
            <Image
              source={require('@/../assets/images/bread-toast-wordmark.png')}
              style={styles.footerWordmark}
              resizeMode="contain"
            />
          </View>
        </View>
        <View style={styles.footerCopy}>
          <Text style={styles.footerKicker}>Trade ideas together</Text>
          <Text style={styles.footerLabel}>{footerLabel}</Text>
        </View>
      </View>

      <Image
        source={require('@/../assets/images/share-card-paper-texture.png')}
        style={styles.cardTexture}
        resizeMode="cover"
        accessible={false}
      />

      <View pointerEvents="none" style={[styles.stampEdgeHorizontal, styles.stampEdgeTop]}>
        {STAMP_HORIZONTAL_PERFORATIONS.map((index) => (
          <View key={`stamp-top-${index}`} style={styles.stampPerforation} />
        ))}
      </View>
      <View pointerEvents="none" style={[styles.stampEdgeHorizontal, styles.stampEdgeBottom]}>
        {STAMP_HORIZONTAL_PERFORATIONS.map((index) => (
          <View key={`stamp-bottom-${index}`} style={styles.stampPerforation} />
        ))}
      </View>
      <View pointerEvents="none" style={[styles.stampEdgeVertical, styles.stampEdgeLeft]}>
        {STAMP_VERTICAL_PERFORATIONS.map((index) => (
          <View key={`stamp-left-${index}`} style={styles.stampPerforation} />
        ))}
      </View>
      <View pointerEvents="none" style={[styles.stampEdgeVertical, styles.stampEdgeRight]}>
        {STAMP_VERTICAL_PERFORATIONS.map((index) => (
          <View key={`stamp-right-${index}`} style={styles.stampPerforation} />
        ))}
      </View>
    </View>
  );
}

/** A compact trading receipt for the second picker option. */
function ReceiptSharePerformanceCard({
  title,
  subtitle,
  dateLabel,
  identityLabel,
  returnValue,
  returnDetail,
  positive,
  returnColorOverride,
  stats,
  footerLabel = 'breadapp.fun',
}: SharePerformanceCardProps) {
  const returnColor = returnColorOverride ?? (positive ? SHARE_CARD_POSITIVE : SHARE_CARD_NEGATIVE);

  return (
    <View style={styles.receiptCard}>
      <Image
        source={require('@/../assets/images/share-card-paper-texture.png')}
        style={styles.receiptTexture}
        resizeMode="cover"
        accessible={false}
      />
      <Image
        source={require('@/../assets/images/logo.png')}
        style={styles.receiptWatermark}
        resizeMode="contain"
        accessible={false}
      />

      <View style={styles.receiptHeader}>
        <Text style={styles.receiptBrand}>BREAD RECEIPT</Text>
        <Text style={styles.receiptSubhead}>POSITION SNAPSHOT</Text>
      </View>

      <View style={styles.receiptMeta}>
        <Text style={styles.receiptMetaText} numberOfLines={1} adjustsFontSizeToFit>
          ORDER FOR {identityLabel.toUpperCase()}
        </Text>
        <Text style={styles.receiptMetaText}>{dateLabel.toUpperCase()}</Text>
      </View>

      <View style={styles.receiptDivider} />

      <View style={styles.receiptAssetRow}>
        <View style={styles.receiptAssetCopy}>
          <Text style={styles.receiptLabel}>ASSET</Text>
          <Text style={styles.receiptAssetName} numberOfLines={2} adjustsFontSizeToFit>
            {title.toUpperCase()}
          </Text>
        </View>
        <Text style={styles.receiptTicker} numberOfLines={1} adjustsFontSizeToFit>
          {subtitle.toUpperCase()}
        </Text>
      </View>

      <View style={styles.receiptDivider} />
      <View style={styles.receiptTableHeader}>
        <Text style={styles.receiptTableHeaderText}>ITEM</Text>
        <Text style={styles.receiptTableHeaderText}>AMOUNT</Text>
      </View>
      <View style={styles.receiptStats}>
        {stats.slice(0, 3).map((stat, index) => (
          <View key={`${stat.label}-${index}`} style={styles.receiptStatRow}>
            <Text style={styles.receiptStatIndex}>{String(index + 1).padStart(2, '0')}</Text>
            <Text style={styles.receiptStatLabel} numberOfLines={1}>{stat.label.toUpperCase()}</Text>
            <Text style={styles.receiptStatValue} numberOfLines={1} adjustsFontSizeToFit>
              {stat.value}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.receiptDivider} />
      <View style={styles.receiptTotalRow}>
        <Text style={styles.receiptTotalLabel}>TOTAL RETURN</Text>
        <Text
          style={[styles.receiptTotalValue, { color: returnColor }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {returnValue}
        </Text>
      </View>
      {returnDetail ? (
        <Text style={[styles.receiptReturnDetail, { color: returnColor }]} numberOfLines={1}>
          {returnDetail.toUpperCase()}
        </Text>
      ) : null}

      <View style={styles.receiptDivider} />
      <Text style={styles.receiptThanks}>THANK YOU FOR TRADING</Text>
      <View style={styles.receiptBarcode} accessible={false}>
        {Array.from({ length: 42 }, (_, index) => (
          <View
            key={`receipt-bar-${index}`}
            style={[
              styles.receiptBarcodeBar,
              { width: index % 7 === 0 ? 3 : index % 3 === 0 ? 2 : 1 },
            ]}
          />
        ))}
      </View>
      <Text style={styles.receiptFooter}>{footerLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  variantPicker: {
    minHeight: 44,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    borderRadius: 14,
    backgroundColor: '#E9EBEF',
  },
  variantButton: {
    minWidth: 92,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingHorizontal: 16,
  },
  variantButtonSelected: { backgroundColor: '#FFFFFF' },
  variantButtonText: {
    color: SHARE_CARD_MUTED,
    fontFamily: F,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  variantButtonTextSelected: { color: SHARE_CARD_INK },
  card: {
    width: '100%',
    aspectRatio: 0.78,
    borderRadius: 28,
    padding: 4,
    paddingBottom: 0,
    overflow: 'hidden',
    backgroundColor: SHARE_CARD_ACCENT,
  },
  canvas: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  cardTexture: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.28,
    mixBlendMode: 'multiply',
  },
  stampEdgeHorizontal: {
    position: 'absolute',
    left: 10,
    right: 10,
    height: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stampEdgeVertical: {
    position: 'absolute',
    top: 12,
    bottom: 12,
    width: 10,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stampEdgeTop: {
    top: -5,
  },
  stampEdgeBottom: {
    bottom: -5,
  },
  stampEdgeLeft: {
    left: -5,
  },
  stampEdgeRight: {
    right: -5,
  },
  stampPerforation: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
  },
  header: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  assetIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: SHARE_CARD_PANEL,
  },
  assetIconFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: SHARE_CARD_BORDER,
  },
  assetIconInitial: {
    color: SHARE_CARD_INK,
    fontFamily: F,
    fontSize: 18,
    fontWeight: '900',
  },
  assetCopy: {
    flex: 1,
    minWidth: 0,
  },
  assetName: {
    color: SHARE_CARD_INK,
    fontFamily: F_DISPLAY,
    fontSize: 21,
    lineHeight: 25,
    fontWeight: '900',
  },
  assetSymbol: {
    color: SHARE_CARD_MUTED,
    fontFamily: F,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
  },
  date: {
    alignSelf: 'flex-start',
    marginTop: 4,
    color: SHARE_CARD_MUTED,
    fontFamily: F,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  chart: {
    flex: 1,
    minHeight: 108,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  performancePanel: {
    marginHorizontal: 10,
    marginBottom: 10,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: SHARE_CARD_BORDER,
    backgroundColor: SHARE_CARD_PANEL,
  },
  identityRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  identityLogo: {
    width: 26,
    height: 26,
  },
  identityText: {
    flexShrink: 1,
    color: SHARE_CARD_INK,
    fontFamily: F,
    fontSize: 15,
    fontWeight: '900',
  },
  returnRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  returnValue: {
    maxWidth: '62%',
    fontFamily: F_PERCENT,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  returnDetail: {
    maxWidth: '35%',
    fontFamily: F_PERCENT,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  statsRow: {
    minHeight: 62,
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: SHARE_CARD_BORDER,
  },
  stat: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 6,
  },
  statDivided: {
    borderLeftWidth: 1,
    borderLeftColor: SHARE_CARD_BORDER,
  },
  statLabel: {
    color: SHARE_CARD_MUTED,
    fontFamily: F,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  statValue: {
    color: SHARE_CARD_INK,
    fontFamily: F,
    fontSize: 17,
    lineHeight: 21,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  footer: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  footerBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerLogo: {
    width: 38,
    height: 38,
  },
  footerWordmarkGlow: {
    width: 108,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerWordmark: {
    width: 104,
    height: 44,
  },
  footerCopy: {
    alignItems: 'flex-end',
  },
  footerKicker: {
    color: SHARE_CARD_INK,
    fontFamily: F,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  footerLabel: {
    color: SHARE_CARD_INK,
    fontFamily: F,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
  },
  receiptCard: {
    width: '100%',
    aspectRatio: 0.62,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#D8D4C8',
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 30,
    backgroundColor: '#F5F3EC',
  },
  receiptTexture: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.42,
    mixBlendMode: 'multiply',
  },
  receiptWatermark: {
    position: 'absolute',
    top: 150,
    left: 34,
    width: 270,
    height: 270,
    opacity: 0.055,
    transform: [{ rotate: '-18deg' }],
  },
  receiptHeader: { alignItems: 'center', gap: 4, marginBottom: 20 },
  receiptBrand: {
    color: '#171717',
    fontFamily: F_MONO,
    fontSize: 25,
    lineHeight: 30,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  receiptSubhead: {
    color: '#333333',
    fontFamily: F_MONO,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1.2,
  },
  receiptMeta: { gap: 3 },
  receiptMetaText: {
    color: '#242424',
    fontFamily: F_MONO,
    fontSize: 11,
    lineHeight: 15,
    fontVariant: ['tabular-nums'],
  },
  receiptDivider: {
    height: 1,
    marginVertical: 9,
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    borderBottomColor: '#454545',
  },
  receiptAssetRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 16,
  },
  receiptAssetCopy: { flex: 1, minWidth: 0, gap: 3 },
  receiptLabel: { color: '#555555', fontFamily: F_MONO, fontSize: 10, lineHeight: 13 },
  receiptAssetName: {
    color: '#171717',
    fontFamily: F_MONO,
    fontSize: 17,
    lineHeight: 21,
    fontWeight: '800',
  },
  receiptTicker: {
    maxWidth: '34%',
    color: '#171717',
    fontFamily: F_MONO,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
  },
  receiptTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 7,
  },
  receiptTableHeaderText: {
    color: '#333333',
    fontFamily: F_MONO,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
  },
  receiptStats: { gap: 8 },
  receiptStatRow: { minHeight: 18, flexDirection: 'row', alignItems: 'baseline' },
  receiptStatIndex: {
    width: 28,
    color: '#333333',
    fontFamily: F_MONO,
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
  receiptStatLabel: {
    flex: 1,
    minWidth: 0,
    color: '#222222',
    fontFamily: F_MONO,
    fontSize: 12,
    lineHeight: 16,
  },
  receiptStatValue: {
    maxWidth: '44%',
    color: '#171717',
    fontFamily: F_MONO,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  receiptTotalRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 14,
  },
  receiptTotalLabel: {
    color: '#171717',
    fontFamily: F_MONO,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  receiptTotalValue: {
    maxWidth: '58%',
    fontFamily: F_PERCENT,
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '900',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  receiptReturnDetail: {
    alignSelf: 'flex-end',
    fontFamily: F_PERCENT,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
  },
  receiptThanks: {
    marginTop: 8,
    color: '#242424',
    fontFamily: F_MONO,
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  receiptBarcode: {
    width: '78%',
    height: 40,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  receiptBarcodeBar: { height: 34, backgroundColor: '#171717' },
  receiptFooter: {
    marginTop: 5,
    color: '#242424',
    fontFamily: F_MONO,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
});
