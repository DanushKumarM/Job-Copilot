import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Linking,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, formatErrorMessage } from '../../src/api/client';
import { useTheme } from '../../src/hooks/useTheme';
import { Header } from '../../src/components/Header';
import { Card } from '../../src/components/Card';
import { Badge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { LoadingState } from '../../src/components/LoadingState';
import { ErrorState } from '../../src/components/ErrorState';

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'fit' | 'description' | 'requirements'>('fit');
  const [actionError, setActionError] = useState<string | null>(null);

  const jobQuery = useQuery({
    queryKey: ['job', id],
    queryFn: () => api.jobs.get(id),
    enabled: !!id,
  });

  const evaluateMutation = useMutation({
    mutationFn: () => api.jobs.evaluate(id),
    onSuccess: (updated) => {
      queryClient.setQueryData(['job', id], updated);
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setActionError(null);
    },
    onError: (err) => setActionError(formatErrorMessage(err)),
  });

  const extractMutation = useMutation({
    mutationFn: () => api.jobs.extract(id),
    onSuccess: (updated) => {
      queryClient.setQueryData(['job', id], updated);
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setActionError(null);
    },
    onError: (err) => setActionError(formatErrorMessage(err)),
  });

  const createApplicationMutation = useMutation({
    mutationFn: () => api.jobs.createApplication(id),
    onSuccess: (app) => {
      queryClient.invalidateQueries({ queryKey: ['job', id] });
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      router.push(`/applications/${app.id}` as any);
    },
    onError: (err) => setActionError(formatErrorMessage(err)),
  });

  if (jobQuery.isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <Header title="Job Details" showBack />
        <LoadingState count={3} />
      </View>
    );
  }

  if (jobQuery.isError || !jobQuery.data) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <Header title="Job Details" showBack />
        <ErrorState onRetry={() => jobQuery.refetch()} />
      </View>
    );
  }

  const job = jobQuery.data;
  const fitPercent = Math.round((job.overall_fit || 0) * 100);
  const fitVariant = fitPercent >= 75 ? 'success' : fitPercent >= 50 ? 'primary' : 'neutral';

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header
        title={job.title}
        subtitle={job.company_name}
        showBack
        rightAction={
          job.posting_url ? (
            <TouchableOpacity
              onPress={() => Linking.openURL(job.posting_url!)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="open-outline" size={22} color={theme.colors.primaryLight} />
            </TouchableOpacity>
          ) : undefined
        }
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={jobQuery.isRefetching}
            onRefresh={() => jobQuery.refetch()}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
      >
        {actionError && (
          <View style={[styles.errorBox, { backgroundColor: theme.colors.dangerMuted }]}>
            <Text style={{ color: theme.colors.danger, fontSize: 13 }}>{actionError}</Text>
          </View>
        )}

        {/* Score & Header Card */}
        <Card variant="raised" style={styles.scoreCard}>
          <View style={styles.scoreRow}>
            <View>
              <Text style={[styles.companyText, { color: theme.colors.textMuted }]}>
                {job.company_name}
              </Text>
              <Text style={[styles.titleText, { color: theme.colors.text }]}>{job.title}</Text>
              <View style={styles.metaRow}>
                {job.location && (
                  <Text style={[styles.metaText, { color: theme.colors.textMuted }]}>
                    📍 {job.location}
                  </Text>
                )}
                {job.work_mode && (
                  <Text style={[styles.metaText, { color: theme.colors.textMuted, textTransform: 'capitalize' }]}>
                    🏢 {job.work_mode}
                  </Text>
                )}
              </View>
            </View>
            <View style={[styles.scoreCircle, { borderColor: fitVariant === 'success' ? theme.colors.success : theme.colors.primary }]}>
              <Text style={[styles.scoreValue, { color: theme.colors.text }]}>{fitPercent}%</Text>
              <Text style={[styles.scoreLabel, { color: theme.colors.textMuted }]}>FIT</Text>
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.actionsContainer}>
            {job.application_id ? (
              <Button
                title="Open Application"
                onPress={() => router.push(`/applications/${job.application_id}` as any)}
                variant="primary"
                icon={<Ionicons name="document-text-outline" size={16} color="#FFFFFF" />}
              />
            ) : (
              <Button
                title="Create Application"
                onPress={() => createApplicationMutation.mutate()}
                loading={createApplicationMutation.isPending}
                variant="primary"
                icon={<Ionicons name="add-circle-outline" size={16} color="#FFFFFF" />}
              />
            )}

            <View style={styles.secondaryActions}>
              <Button
                title="Re-evaluate"
                onPress={() => evaluateMutation.mutate()}
                loading={evaluateMutation.isPending}
                variant="outline"
                size="sm"
                style={{ flex: 1 }}
              />
              <Button
                title="Refine Req."
                onPress={() => extractMutation.mutate()}
                loading={extractMutation.isPending}
                variant="outline"
                size="sm"
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </Card>

        {/* Tab switch: Fit & Evidence / Requirements / Description */}
        <View style={styles.tabSelector}>
          {(['fit', 'requirements', 'description'] as const).map((tab) => (
            <TouchableOpacity
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={[
                styles.tabBtn,
                activeTab === tab && { borderBottomColor: theme.colors.primary, borderBottomWidth: 2 },
              ]}
            >
              <Text
                style={[
                  styles.tabBtnText,
                  { color: activeTab === tab ? theme.colors.text : theme.colors.textMuted },
                ]}
              >
                {tab === 'fit' ? 'Evidence & Fit' : tab === 'requirements' ? 'Requirements' : 'Description'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {activeTab === 'fit' && (
          <View>
            {job.evaluation?.reasoning && (
              <Card style={{ marginBottom: 12 }}>
                <Text style={[styles.sectionSubtitle, { color: theme.colors.text }]}>Evaluation Reasoning</Text>
                <Text style={[styles.bodyText, { color: theme.colors.textMuted }]}>
                  {job.evaluation.reasoning}
                </Text>
              </Card>
            )}

            <Text style={[styles.sectionHeading, { color: theme.colors.text }]}>Requirement Matches</Text>
            {(!job.matches || job.matches.length === 0) ? (
              <Card>
                <Text style={{ color: theme.colors.textMuted }}>No matching evidence calculated yet. Tap Re-evaluate to run match analysis.</Text>
              </Card>
            ) : (
              job.matches.map((match, i) => (
                <Card key={i} style={styles.matchCard}>
                  <View style={styles.matchTop}>
                    <Text style={[styles.reqStatement, { color: theme.colors.text }]}>
                      {match.statement}
                    </Text>
                    <Badge
                      label={`${Math.round(match.score * 100)}%`}
                      variant={match.score >= 0.7 ? 'success' : match.score >= 0.4 ? 'warning' : 'neutral'}
                    />
                  </View>
                  {match.evidence && (
                    <Text style={[styles.evidenceText, { color: theme.colors.textMuted }]}>
                      💡 Evidence: {match.evidence}
                    </Text>
                  )}
                  {match.gap && (
                    <Text style={[styles.gapText, { color: theme.colors.warning }]}>
                      ⚠️ Gap: {match.gap}
                    </Text>
                  )}
                </Card>
              ))
            )}
          </View>
        )}

        {activeTab === 'requirements' && (
          <View>
            <Text style={[styles.sectionHeading, { color: theme.colors.text }]}>Extracted Requirements</Text>
            {(!job.requirements || job.requirements.length === 0) ? (
              <Card>
                <Text style={{ color: theme.colors.textMuted }}>No requirements extracted yet. Tap Refine Req. to extract.</Text>
              </Card>
            ) : (
              job.requirements.map((req) => (
                <Card key={req.id}>
                  <View style={styles.reqTop}>
                    <Text style={[styles.reqText, { color: theme.colors.text }]}>{req.statement}</Text>
                    <Badge label={req.importance} variant={req.importance === 'high' ? 'danger' : 'neutral'} />
                  </View>
                  {req.min_years && (
                    <Text style={[styles.subtleText, { color: theme.colors.textMuted, marginTop: 4 }]}>
                      Minimum experience: {req.min_years} years
                    </Text>
                  )}
                </Card>
              ))
            )}
          </View>
        )}

        {activeTab === 'description' && (
          <Card>
            <Text style={[styles.sectionSubtitle, { color: theme.colors.text }]}>Full Posting</Text>
            <Text style={[styles.descText, { color: theme.colors.textMuted }]}>
              {job.description || 'No job description text provided.'}
            </Text>
          </Card>
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
    paddingBottom: 40,
  },
  errorBox: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  scoreCard: {
    padding: 18,
    marginBottom: 16,
  },
  scoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  companyText: {
    fontSize: 14,
    fontWeight: '500',
  },
  titleText: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: 2,
    marginBottom: 6,
    maxWidth: 240,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 12,
  },
  metaText: {
    fontSize: 12,
  },
  scoreCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  scoreLabel: {
    fontSize: 10,
    fontWeight: '700',
  },
  actionsContainer: {
    gap: 10,
  },
  secondaryActions: {
    flexDirection: 'row',
    gap: 10,
  },
  tabSelector: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    marginBottom: 16,
  },
  tabBtn: {
    paddingVertical: 10,
    marginRight: 16,
  },
  tabBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  sectionSubtitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 20,
  },
  matchCard: {
    marginBottom: 10,
  },
  matchTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  reqStatement: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  evidenceText: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  gapText: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  reqTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  reqText: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  subtleText: {
    fontSize: 12,
  },
  descText: {
    fontSize: 14,
    lineHeight: 22,
  },
});
