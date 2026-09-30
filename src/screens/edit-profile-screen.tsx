import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { usePrivy } from "@privy-io/expo";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { updateUserProfile, uploadAvatar } from "@/lib/api";
import { CTA } from '@/lib/screen-corners';
import { Fonts, type ThemeColors } from "@/constants/theme";
import { useThemeStore } from "@/lib/theme-store";
import { useThemedStyles } from "@/hooks/use-themed-styles";
import { PressableScale } from '@/components/pressable-scale';

const F = Fonts.rounded;
// Heavy Rubik display face — matches the Sandwich detail "BUY" CTA.
const F_DISPLAY = Fonts.display;

// Mirrors the backend cap (lib/server/users.ts MAX_BIO_LENGTH).
const MAX_BIO_LENGTH = 160;

/**
 * Full-screen, minimal account editor: profile picture, username, and bio.
 * Pushed over the tab bar from the profile screen. Initial values arrive as
 * route params so the screen can render instantly without a fetch; the profile
 * screen re-reads the canonical values on focus when we navigate back.
 */
export function EditProfileScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useThemeStore();
  const router = useRouter();
  const { user } = usePrivy();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams<{
    avatarUrl?: string;
    username?: string;
    bio?: string;
  }>();

  // The avatar/username/bio the screen opened with — used to detect what
  // actually changed so we only send the fields the user touched.
  const initialAvatar = params.avatarUrl ?? null;
  const initialUsername = params.username ?? "";
  const initialBio = params.bio ?? "";

  const [avatarUri, setAvatarUri] = useState<string | null>(initialAvatar);
  const [username, setUsername] = useState(initialUsername);
  const [bio, setBio] = useState(initialBio);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    avatarUri !== initialAvatar ||
    username.trim() !== initialUsername.trim() ||
    bio.trim() !== initialBio.trim();

  async function pickAvatar() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      setAvatarUri(result.assets[0].uri);
    }
  }

  async function handleSave() {
    if (!user?.id || saving || !dirty) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSaving(true);
    setError(null);

    try {
      const updates: { username?: string; avatarUrl?: string; bio?: string } = {};

      const trimmedUsername = username.trim().toLowerCase();
      if (trimmedUsername && trimmedUsername !== initialUsername.trim()) {
        updates.username = trimmedUsername;
      }

      // Bio: send whenever it changed, including a clear-to-empty (backend
      // treats an empty string as "remove the bio").
      const trimmedBio = bio.trim();
      if (trimmedBio !== initialBio.trim()) {
        updates.bio = trimmedBio;
      }

      // Avatar: a local file URI gets uploaded to R2 (which persists the URL);
      // an already-remote URL is saved directly; a cleared avatar is removed.
      const avatarChanged = avatarUri !== initialAvatar;
      if (avatarChanged && avatarUri) {
        const isLocal =
          avatarUri.startsWith("file://") ||
          avatarUri.startsWith("ph://") ||
          !avatarUri.startsWith("http");
        if (isLocal) {
          await uploadAvatar(user.id, avatarUri);
        } else {
          updates.avatarUrl = avatarUri;
        }
      } else if (avatarChanged && !avatarUri) {
        updates.avatarUrl = "";
      }

      if (Object.keys(updates).length > 0) {
        await updateUserProfile(user.id, updates);
      }

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Couldn't save changes. Try again.";
      setError(message);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          // Clear the transparent native header (status bar + ~44pt bar).
          { paddingTop: insets.top + 52, paddingBottom: insets.bottom + 48 },
        ]}
        // Drag to dismiss the keyboard, and let taps on inputs/buttons through
        // while a tap on empty space closes it (via the wrapper below).
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View>
        <Text style={styles.title}>Account</Text>

        {/* Profile picture */}
        <View style={styles.avatarSection}>
          <Pressable onPress={() => void pickAvatar()} style={styles.avatarCircle}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarDefault}>
                <Ionicons name="person" size={44} color={colors.iconMuted} />
              </View>
            )}
            <View style={styles.avatarBadge}>
              <Ionicons name="pencil" size={14} color="#ffffff" />
            </View>
          </Pressable>
          {avatarUri ? (
            <Pressable onPress={() => setAvatarUri(null)} style={styles.removePhotoBtn}>
              <Text style={styles.removePhotoText}>Remove photo</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Username */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Username</Text>
          <View style={styles.usernameInputWrap}>
            <Text style={styles.usernameAt}>@</Text>
            <TextInput
              value={username}
              onChangeText={(text) =>
                setUsername(text.toLowerCase().replace(/[^a-z0-9_]/g, ""))
              }
              placeholder="username"
              placeholderTextColor={colors.iconMuted}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
              style={styles.usernameInput}
            />
          </View>
        </View>

        {/* Bio */}
        <View style={styles.fieldGroup}>
          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabel}>A short description</Text>
            <Text style={styles.bioCount}>
              {bio.length} / {MAX_BIO_LENGTH}
            </Text>
          </View>
          <TextInput
            value={bio}
            onChangeText={setBio}
            placeholder="Describe yourself"
            placeholderTextColor={colors.iconMuted}
            multiline
            maxLength={MAX_BIO_LENGTH}
            style={[styles.fieldInput, styles.bioInput]}
          />
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* Save — same CTA design as the Sandwich detail "BUY" button. */}
        <PressableScale
          accessibilityRole="button"
          onPress={() => void handleSave()}
          disabled={saving || !dirty}
          style={[styles.saveBtn, (!dirty || saving) && styles.saveBtnDisabled]}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.saveBtnText}>SAVE</Text>
          )}
        </PressableScale>
          </View>
        </TouchableWithoutFeedback>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    page: {
      flex: 1,
      backgroundColor: c.background,
    },
    scrollContent: {
      paddingHorizontal: 20,
    },
    title: {
      color: c.text,
      fontSize: 34,
      fontWeight: "800",
      fontFamily: F,
      marginTop: 4,
      marginBottom: 24,
    },
    avatarSection: {
      alignItems: "flex-start",
      gap: 10,
      marginBottom: 28,
    },
    avatarCircle: {
      width: 110,
      height: 110,
      borderRadius: 55,
    },
    avatarImage: {
      width: 110,
      height: 110,
      borderRadius: 55,
      backgroundColor: c.surfaceAlt,
    },
    avatarDefault: {
      width: 110,
      height: 110,
      borderRadius: 55,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarBadge: {
      position: "absolute",
      right: 2,
      bottom: 2,
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: c.icon,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 3,
      borderColor: c.background,
    },
    removePhotoBtn: {
      paddingVertical: 4,
      paddingHorizontal: 8,
    },
    removePhotoText: {
      color: c.textTertiary,
      fontSize: 13,
      fontWeight: "600",
      fontFamily: F,
    },
    fieldGroup: {
      gap: 8,
      marginBottom: 22,
    },
    fieldLabelRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    fieldLabel: {
      color: c.textTertiary,
      fontSize: 15,
      fontWeight: "600",
      fontFamily: F,
    },
    bioCount: {
      color: c.textTertiary,
      fontSize: 14,
      fontWeight: "500",
      fontFamily: F,
    },
    fieldInput: {
      backgroundColor: c.surfaceAlt,
      borderRadius: 14,
      paddingHorizontal: 18,
      paddingVertical: 16,
      fontSize: 18,
      fontWeight: "600",
      color: c.text,
      fontFamily: F,
    },
    usernameInputWrap: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.surfaceAlt,
      borderRadius: 14,
      paddingHorizontal: 18,
    },
    usernameAt: {
      color: c.textTertiary,
      fontSize: 18,
      fontWeight: "700",
      fontFamily: F,
      marginRight: 8,
    },
    usernameInput: {
      flex: 1,
      paddingVertical: 16,
      fontSize: 18,
      fontWeight: "600",
      color: c.text,
      fontFamily: F,
    },
    bioInput: {
      minHeight: 120,
      paddingTop: 16,
      textAlignVertical: "top",
    },
    errorText: {
      color: c.negative,
      fontSize: 14,
      fontWeight: "600",
      fontFamily: F,
      marginBottom: 12,
    },
    // Mirrors the Sandwich detail "BUY" CTA exactly (buyButton / buyButtonText
    // / buyButtonPressed / buyButtonDisabled in sandwich-screen.tsx).
    saveBtn: {
      minHeight: CTA.height,
      borderRadius: CTA.radius,
      backgroundColor: c.accentBlue,
      overflow: "hidden",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      paddingHorizontal: 18,
      marginTop: 4,
    },
    saveBtnDisabled: {
      opacity: 0.28,
    },
    saveBtnText: {
      // Always white — the button is a saturated theme blue in both themes.
      color: "#ffffff",
      fontSize: 26,
      lineHeight: 26,
      fontWeight: "900",
      fontFamily: F_DISPLAY,
      letterSpacing: 1,
    },
  });
