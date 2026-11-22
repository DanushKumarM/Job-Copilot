import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '../hooks/useTheme';

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  badge?: number;
}

export interface FilterTabsProps<T extends string = string> {
  tabs: TabItem<T>[];
  activeTab: T;
  onTabChange: (tabId: T) => void;
  style?: any;
}

export function FilterTabs<T extends string = string>({
  tabs,
  activeTab,
  onTabChange,
  style,
}: FilterTabsProps<T>) {
  const { theme } = useTheme();

  return (
    <View style={[styles.container, style]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <TouchableOpacity
              key={tab.id}
              activeOpacity={0.7}
              onPress={() => onTabChange(tab.id)}
              style={[
                styles.tab,
                {
                  backgroundColor: isActive ? theme.colors.primary : theme.colors.surface,
                  borderColor: isActive ? theme.colors.primary : theme.colors.border,
                  borderRadius: theme.radius.full,
                },
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: isActive ? '#FFFFFF' : theme.colors.textMuted },
                ]}
              >
                {tab.label}
              </Text>
              {typeof tab.badge === 'number' && (
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor: isActive ? 'rgba(255,255,255,0.25)' : theme.colors.surfaceRaised,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      { color: isActive ? '#FFFFFF' : theme.colors.textMuted },
                    ]}
                  >
                    {tab.badge}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 10,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  badge: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
