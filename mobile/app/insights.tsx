import React from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../src/api/client';
import { useTheme } from '../src/hooks/useTheme';
import { Header } from '../src/components/Header';
import { Card } from '../src/components/Card';
import { LoadingState } from '../src/components/LoadingState';
import { ErrorState } from '../src/components/ErrorState';

export default function InsightsScreen() {
  const { theme } = useTheme();

  const funnelQuery = useQuery({
    queryKey: ['funnel-analytics'],
    queryFn: () => api.analytics.getFunnel(),
  });

  const funnel = funnelQuery.data;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header
        title="Insights & Analytics"
        subtitle="Funnel conversion and system metrics"
        showBack
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={funnelQuery.isRefetching}
            onRefresh={() => funnelQuery.refetch()}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
      >
        {funnelQuery.isLoading && !funnelQuery.isRefetching ? (
          <LoadingState count={3} />
        ) : funnelQuery.isError ? (
          <ErrorState onRetry={() => funnelQuery.refetch()} />
        ) : (
          <>
            {/* Top Stat Highlights */}
            <View style={styles.metricsGrid}>
              <View style={[styles.metricCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <Ionicons name="sparkles-outline" size={20} color={theme.colors.primaryLight} />
                <Text style={[styles.metricValue, { color: theme.colors.text }]}>
                  {funnel?.llm_call_count ?? 0}
                </Text>
                <Text style={[styles.metricLabel, { color: theme.colors.textMuted }]}>
                  LLM Generations
                </Text>
              </View>

              <View style={[styles.metricCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <Ionicons name="hourglass-outline" size={20} color={theme.colors.warning} />
                <Text style={[styles.metricValue, { color: theme.colors.warning }]}>
                  {funnel?.submitted_unconfirmed_count ?? 0}
                </Text>
                <Text style={[styles.metricLabel, { color: theme.colors.textMuted }]}>
                  Unconfirmed
                </Text>
              </View>

              <View style={[styles.metricCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <Ionicons name="cash-outline" size={20} color={theme.colors.success} />
                <Text style={[styles.metricValue, { color: theme.colors.success }]}>
                  ₹{(funnel?.total_cost_inr ?? 0).toFixed(2)}
                </Text>
                <Text style={[styles.metricLabel, { color: theme.colors.textMuted }]}>
                  Total Cost
                </Text>
              </View>
            </View>

            {/* Funnel By Status */}
            <Card style={styles.sectionCard}>
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                Application Funnel Stages
              </Text>
              <Text style={[styles.sectionSub, { color: theme.colors.textMuted }]}>
                Count of applications currently in each status
              </Text>

              {(!funnel?.funnel_by_status || Object.keys(funnel.funnel_by_status).length === 0) ? (
                <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>
                  No status counts recorded yet.
                </Text>
              ) : (
                Object.entries(funnel.funnel_by_status).map(([status, count]) => (
                  <View key={status} style={styles.funnelRow}>
                    <Text style={[styles.statusKey, { color: theme.colors.text }]}>
                      {status.replace(/_/g, ' ')}
                    </Text>
                    <View style={[styles.countBadge, { backgroundColor: theme.colors.surfaceRaised }]}>
                      <Text style={[styles.countBadgeText, { color: theme.colors.primaryLight }]}>
                        {count}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </Card>

            {/* Funnel By Source */}
            <Card style={styles.sectionCard}>
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                Applications By Ingestion Source
              </Text>
              <Text style={[styles.sectionSub, { color: theme.colors.textMuted }]}>
                Greenhouse, Lever, manual paste, or inbound Gmail import
              </Text>

              {(!funnel?.funnel_by_source || Object.keys(funnel.funnel_by_source).length === 0) ? (
                <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>
                  No source breakdown available.
                </Text>
              ) : (
                Object.entries(funnel.funnel_by_source).map(([src, count]) => (
                  <View key={src} style={styles.funnelRow}>
                    <Text style={[styles.statusKey, { color: theme.colors.text }]}>{src}</Text>
                    <View style={[styles.countBadge, { backgroundColor: theme.colors.surfaceRaised }]}>
                      <Text style={[styles.countBadgeText, { color: theme.colors.primaryLight }]}>
                        {count}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  metricCard: {
    flex: 1,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    gap: 4,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  metricLabel: {
    fontSize: 11,
    textAlign: 'center',
    fontWeight: '500',
  },
  sectionCard: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  sectionSub: {
    fontSize: 12,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 13,
    paddingVertical: 12,
  },
  funnelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  statusKey: {
    fontSize: 14,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  countBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
