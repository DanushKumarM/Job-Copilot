import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/hooks/useAuth';
import { useTheme } from '../../src/hooks/useTheme';
import { Header } from '../../src/components/Header';
import { Card } from '../../src/components/Card';
import { ConfirmModal } from '../../src/components/ConfirmModal';

interface MenuItem {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  route: string;
}

const MENU_ITEMS: MenuItem[] = [
  {
    icon: 'person-outline',
    title: 'Profile & Facts',
    subtitle: 'Review facts, import resume, and manage profile',
    route: '/profile',
  },
  {
    icon: 'chatbubble-ellipses-outline',
    title: 'Answer Bank',
    subtitle: 'Manage standard candidate screening responses',
    route: '/answers',
  },
  {
    icon: 'globe-outline',
    title: 'Job Boards & Sources',
    subtitle: 'Greenhouse & Lever ATS sync connections',
    route: '/sources',
  },
  {
    icon: 'bar-chart-outline',
    title: 'Insights & Analytics',
    subtitle: 'Funnel stages, conversion, and LLM usage metrics',
    route: '/insights',
  },
  {
    icon: 'settings-outline',
    title: 'Settings & Status',
    subtitle: 'API endpoint, theme, and backend health',
    route: '/settings',
  },
];

export default function MoreScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

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
      <Header title="More Options" subtitle="Profile, sources, and preferences" />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* User Card */}
        <Card variant="raised" style={styles.userCard}>
          <View style={styles.userRow}>
            <View style={[styles.avatar, { backgroundColor: theme.colors.primaryMuted }]}>
              <Ionicons name="person" size={24} color={theme.colors.primaryLight} />
            </View>
            <View style={styles.userInfo}>
              <Text style={[styles.userName, { color: theme.colors.text }]} numberOfLines={1}>
                {user?.email || 'Candidate'}
              </Text>
              <Text style={[styles.userBadge, { color: theme.colors.success }]}>
                ● Active Session
              </Text>
            </View>
          </View>
        </Card>

        {/* Menu Navigation Items */}
        <View style={styles.menuList}>
          {MENU_ITEMS.map((item) => (
            <Card
              key={item.route}
              onPress={() => router.push(item.route as any)}
              style={styles.menuCard}
            >
              <View style={styles.menuRow}>
                <View style={[styles.menuIconBox, { backgroundColor: theme.colors.surfaceRaised }]}>
                  <Ionicons name={item.icon} size={22} color={theme.colors.primaryLight} />
                </View>
                <View style={styles.menuText}>
                  <Text style={[styles.menuTitle, { color: theme.colors.text }]}>
                    {item.title}
                  </Text>
                  <Text style={[styles.menuSubtitle, { color: theme.colors.textMuted }]}>
                    {item.subtitle}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
              </View>
            </Card>
          ))}
        </View>

        {/* Sign Out Card */}
        <Card onPress={() => setConfirmLogout(true)} style={[styles.logoutCard, { borderColor: theme.colors.dangerMuted }]}>
          <View style={styles.menuRow}>
            <View style={[styles.menuIconBox, { backgroundColor: theme.colors.dangerMuted }]}>
              <Ionicons name="log-out-outline" size={22} color={theme.colors.danger} />
            </View>
            <View style={styles.menuText}>
              <Text style={[styles.menuTitle, { color: theme.colors.danger }]}>
                Sign Out
              </Text>
              <Text style={[styles.menuSubtitle, { color: theme.colors.textMuted }]}>
                Revoke session token on this device
              </Text>
            </View>
          </View>
        </Card>
      </ScrollView>

      {/* Confirm Sign Out */}
      <ConfirmModal
        visible={confirmLogout}
        title="Sign Out"
        message="Are you sure you want to sign out? Your stored session token will be removed."
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
  userCard: {
    marginBottom: 20,
    padding: 16,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  userBadge: {
    fontSize: 12,
    fontWeight: '600',
  },
  menuList: {
    gap: 4,
    marginBottom: 16,
  },
  menuCard: {
    marginBottom: 8,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  menuText: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  menuSubtitle: {
    fontSize: 12,
  },
  logoutCard: {
    marginTop: 8,
  },
});
