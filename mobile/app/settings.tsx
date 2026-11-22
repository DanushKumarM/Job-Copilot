import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, getBaseApiUrl } from '../src/api/client';
import { useTheme } from '../src/hooks/useTheme';
import { useAuth } from '../src/hooks/useAuth';
import { Header } from '../src/components/Header';
import { Card } from '../src/components/Card';
import { Badge } from '../src/components/Badge';
import { Button } from '../src/components/Button';
import { ConfirmModal } from '../src/components/ConfirmModal';

export default function SettingsScreen() {
  const { theme, mode, setMode } = useTheme();
  const { user, logout } = useAuth();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: () => api.health(),
    refetchInterval: 15000,
  });

  const apiUrl = getBaseApiUrl();
  const isHealthy = healthQuery.data?.ok === true;

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
      setConfirmLogout(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header title="Settings & Status" showBack />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Backend Health & URL */}
        <Card style={styles.sectionCard}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
            Backend Connection
          </Text>

          <View style={styles.row}>
            <Text style={[styles.label, { color: theme.colors.textMuted }]}>API Endpoint</Text>
            <Text style={[styles.value, { color: theme.colors.text, fontFamily: 'monospace' }]}>
              {apiUrl}
            </Text>
          </View>

          <View style={styles.row}>
            <Text style={[styles.label, { color: theme.colors.textMuted }]}>Health Status</Text>
            <Badge
              label={healthQuery.isLoading ? 'Checking...' : isHealthy ? 'Healthy (OK)' : 'Unreachable'}
              variant={isHealthy ? 'success' : 'danger'}
            />
          </View>

          {!apiUrl.startsWith('https://') && (
            <View style={[styles.warningBox, { backgroundColor: theme.colors.warningMuted }]}>
              <Ionicons name="warning-outline" size={16} color={theme.colors.warning} />
              <Text style={[styles.warningText, { color: theme.colors.warning }]}>
                Cleartext HTTP in use for development. Production must use HTTPS.
              </Text>
            </View>
          )}
        </Card>

        {/* Account Details */}
        <Card style={styles.sectionCard}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Account</Text>

          <View style={styles.row}>
            <Text style={[styles.label, { color: theme.colors.textMuted }]}>Signed in as</Text>
            <Text style={[styles.value, { color: theme.colors.text }]}>{user?.email || 'N/A'}</Text>
          </View>

          <View style={styles.row}>
            <Text style={[styles.label, { color: theme.colors.textMuted }]}>User ID</Text>
            <Text
              style={[styles.value, { color: theme.colors.textMuted, fontSize: 12, fontFamily: 'monospace' }]}
              numberOfLines={1}
            >
              {user?.id || 'N/A'}
            </Text>
          </View>
        </Card>

        {/* Theme Settings */}
        <Card style={styles.sectionCard}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Appearance</Text>
          <Text style={[styles.subLabel, { color: theme.colors.textMuted }]}>
            Choose between dark mode or system default
          </Text>

          <View style={styles.themeSelector}>
            {(['system', 'dark', 'light'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                onPress={() => setMode(t)}
                style={[
                  styles.themeBtn,
                  {
                    backgroundColor: mode === t ? theme.colors.primary : theme.colors.surfaceRaised,
                    borderColor: mode === t ? theme.colors.primary : theme.colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.themeBtnText,
                    { color: mode === t ? '#FFFFFF' : theme.colors.textMuted },
                  ]}
                >
                  {t}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>

        {/* App Info */}
        <Card style={styles.sectionCard}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>About</Text>
          <View style={styles.row}>
            <Text style={[styles.label, { color: theme.colors.textMuted }]}>App Version</Text>
            <Text style={[styles.value, { color: theme.colors.text }]}>Job-Copilot 1.0.0 (Native Android)</Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.label, { color: theme.colors.textMuted }]}>Architecture</Text>
            <Text style={[styles.value, { color: theme.colors.text }]}>Expo Router / React Native</Text>
          </View>
        </Card>

        {/* Sign Out Action */}
        <Button
          title="Sign Out"
          onPress={() => setConfirmLogout(true)}
          variant="danger"
          style={{ marginTop: 8 }}
          icon={<Ionicons name="log-out-outline" size={16} color="#FFFFFF" />}
        />
      </ScrollView>

      {/* Confirm Sign Out */}
      <ConfirmModal
        visible={confirmLogout}
        title="Sign Out"
        message="This will revoke your active session and delete the stored token."
        confirmText="Sign Out"
        confirmVariant="danger"
        loading={isLoggingOut}
        onConfirm={handleLogout}
        onCancel={() => setConfirmLogout(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionCard: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  subLabel: {
    fontSize: 12,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  label: {
    fontSize: 14,
  },
  value: {
    fontSize: 14,
    fontWeight: '600',
  },
  warningBox: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
    alignItems: 'center',
  },
  warningText: {
    fontSize: 12,
    flex: 1,
    lineHeight: 16,
  },
  themeSelector: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  themeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  themeBtnText: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
});
