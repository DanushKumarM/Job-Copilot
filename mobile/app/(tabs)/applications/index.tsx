import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../../src/api/client';
import { useTheme } from '../../../src/hooks/useTheme';
import { Header } from '../../../src/components/Header';
import { Card } from '../../../src/components/Card';
import { Badge } from '../../../src/components/Badge';
import { LoadingState } from '../../../src/components/LoadingState';
import { ErrorState } from '../../../src/components/ErrorState';
import { EmptyState } from '../../../src/components/EmptyState';
import { ApplicationDetail, PIPELINE_STAGES, PipelineStage } from '../../../src/types/api';

export default function PipelineScreen() {
  const { theme } = useTheme();
  const router = useRouter();

  const [expandedStages, setExpandedStages] = useState<Record<PipelineStage, boolean>>({
    attention: true,
    prepare: true,
    review: true,
    ready: true,
    submitted: true,
    in_process: true,
    closed: false, // Closed stages collapsed by default
  });

  const applicationsQuery = useQuery({
    queryKey: ['applications'],
    queryFn: () => api.applications.list(),
  });

  const toggleStage = (stageId: PipelineStage) => {
    setExpandedStages((prev) => ({
      ...prev,
      [stageId]: !prev[stageId],
    }));
  };

  const grouped = useMemo(() => {
    const apps = applicationsQuery.data || [];
    const map: Record<PipelineStage, ApplicationDetail[]> = {
      attention: [],
      prepare: [],
      review: [],
      ready: [],
      submitted: [],
      in_process: [],
      closed: [],
    };

    for (const app of apps) {
      const stage = PIPELINE_STAGES.find((s) => s.statuses.includes(app.status));
      if (stage) {
        map[stage.id].push(app);
      } else {
        map.closed.push(app);
      }
    }
    return map;
  }, [applicationsQuery.data]);

  const totalApps = applicationsQuery.data?.length || 0;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header
        title="Application Pipeline"
        subtitle={`${totalApps} applications in progress`}
      />

      {applicationsQuery.isLoading && !applicationsQuery.isRefetching ? (
        <LoadingState count={4} />
      ) : applicationsQuery.isError ? (
        <ErrorState onRetry={() => applicationsQuery.refetch()} />
      ) : totalApps === 0 ? (
        <EmptyState
          icon="layers-outline"
          title="No applications in pipeline"
          description="Browse your tracked jobs and shortlist one to prepare an application."
          actionTitle="Browse Jobs"
          onAction={() => router.push('/(tabs)/jobs')}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={applicationsQuery.isRefetching}
              onRefresh={() => applicationsQuery.refetch()}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }
        >
          {PIPELINE_STAGES.map((stage) => {
            const stageApps = grouped[stage.id] || [];
            const isExpanded = expandedStages[stage.id];
            const isAttention = stage.id === 'attention' && stageApps.length > 0;

            return (
              <View key={stage.id} style={styles.stageSection}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => toggleStage(stage.id)}
                  style={[
                    styles.stageHeader,
                    {
                      backgroundColor: isAttention
                        ? theme.colors.dangerMuted
                        : theme.colors.surfaceRaised,
                      borderColor: isAttention ? theme.colors.danger : theme.colors.border,
                    },
                  ]}
                >
                  <View style={styles.stageTitleRow}>
                    {isAttention && (
                      <Ionicons
                        name="alert-circle"
                        size={18}
                        color={theme.colors.danger}
                        style={{ marginRight: 6 }}
                      />
                    )}
                    <Text
                      style={[
                        styles.stageTitle,
                        { color: isAttention ? theme.colors.danger : theme.colors.text },
                      ]}
                    >
                      {stage.title}
                    </Text>
                    <View
                      style={[
                        styles.countPill,
                        {
                          backgroundColor: isAttention
                            ? theme.colors.danger
                            : theme.colors.primaryMuted,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.countText,
                          {
                            color: isAttention ? '#FFFFFF' : theme.colors.primaryLight,
                          },
                        ]}
                      >
                        {stageApps.length}
                      </Text>
                    </View>
                  </View>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={theme.colors.textMuted}
                  />
                </TouchableOpacity>

                {isExpanded && (
                  <View style={styles.stageCards}>
                    {stageApps.length === 0 ? (
                      <View style={[styles.emptyStage, { borderColor: theme.colors.border }]}>
                        <Text style={[styles.emptyStageText, { color: theme.colors.textMuted }]}>
                          No applications in this stage
                        </Text>
                      </View>
                    ) : (
                      stageApps.map((app) => {
                        const fitPercent = Math.round((app.fit_score || 0) * 100);
                        const statusVariant = app.status === 'needs_manual_intervention'
                          ? 'danger'
                          : app.status === 'awaiting_approval'
                          ? 'warning'
                          : app.status === 'approved'
                          ? 'success'
                          : 'neutral';

                        return (
                          <Card
                            key={app.id}
                            onPress={() => router.push(`/applications/${app.id}` as any)}
                            style={styles.appCard}
                          >
                            <View style={styles.appTop}>
                              <View style={styles.appTitleBox}>
                                <Text
                                  style={[styles.appJobTitle, { color: theme.colors.text }]}
                                  numberOfLines={1}
                                >
                                  {app.job_title}
                                </Text>
                                <Text
                                  style={[styles.appCompany, { color: theme.colors.textMuted }]}
                                >
                                  {app.company_name}
                                </Text>
                              </View>
                              <Badge
                                label={`${fitPercent}% fit`}
                                variant={fitPercent >= 70 ? 'success' : 'neutral'}
                              />
                            </View>

                            <View style={styles.appFooter}>
                              <Badge
                                label={app.status.replace(/_/g, ' ')}
                                variant={statusVariant}
                              />
                              <View style={styles.lockInfo}>
                                <Ionicons name="lock-closed-outline" size={12} color={theme.colors.textSubtle} />
                                <Text style={[styles.lockText, { color: theme.colors.textSubtle }]}>
                                  v{app.lock_version}
                                </Text>
                              </View>
                            </View>
                          </Card>
                        );
                      })
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
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
  stageSection: {
    marginBottom: 16,
  },
  stageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  stageTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stageTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  countPill: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  countText: {
    fontSize: 12,
    fontWeight: '700',
  },
  stageCards: {
    marginTop: 10,
    gap: 10,
  },
  emptyStage: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  emptyStageText: {
    fontSize: 13,
  },
  appCard: {
    marginBottom: 0,
  },
  appTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  appTitleBox: {
    flex: 1,
    marginRight: 8,
  },
  appJobTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  appCompany: {
    fontSize: 13,
    fontWeight: '500',
  },
  appFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  lockInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  lockText: {
    fontSize: 11,
    fontWeight: '500',
  },
});
