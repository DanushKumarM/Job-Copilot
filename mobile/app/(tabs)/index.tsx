import React from 'react';
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
import { api } from '../../src/api/client';
import { useTheme } from '../../src/hooks/useTheme';
import { Header } from '../../src/components/Header';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { LoadingState } from '../../src/components/LoadingState';
import { ErrorState } from '../../src/components/ErrorState';

export default function HomeScreen() {
  const { theme } = useTheme();
  const router = useRouter();

  const factsQuery = useQuery({
    queryKey: ['facts'],
    queryFn: () => api.profile.getFacts(),
  });

  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.jobs.list(),
  });

  const applicationsQuery = useQuery({
    queryKey: ['applications'],
    queryFn: () => api.applications.list(),
  });

  const isRefreshing = factsQuery.isRefetching || jobsQuery.isRefetching || applicationsQuery.isRefetching;
  const isLoading = factsQuery.isLoading || jobsQuery.isLoading || applicationsQuery.isLoading;
  const hasError = factsQuery.isError || jobsQuery.isError || applicationsQuery.isError;

  const onRefresh = () => {
    factsQuery.refetch();
    jobsQuery.refetch();
    applicationsQuery.refetch();
  };

  if (isLoading && !isRefreshing) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <Header title="Your Job Search" />
        <LoadingState count={3} />
      </View>
    );
  }

  if (hasError && !factsQuery.data && !jobsQuery.data) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <Header title="Your Job Search" />
        <ErrorState onRetry={onRefresh} />
      </View>
    );
  }

  const facts = factsQuery.data || [];
  const jobs = jobsQuery.data || [];
  const applications = applicationsQuery.data || [];

  const verified = facts.filter((f) => f.status === 'verified').length;
  const proposed = facts.filter((f) => f.status === 'proposed').length;
  const active = applications.filter(
    (a) => !['rejected', 'withdrawn', 'rejected_by_rules'].includes(a.status)
  ).length;
  const needsReview = applications.filter((a) =>
    ['awaiting_approval', 'needs_manual_intervention'].includes(a.status)
  ).length;

  const profileReady = verified > 0;
  const jobReady = jobs.length > 0;
  const nextActionTitle = !profileReady
    ? 'Start with your profile'
    : !jobReady
    ? 'Add your first job'
    : 'Choose a job to work on';

  const nextActionDesc = !profileReady
    ? 'Import your resume and verify the facts before anything is used in an application.'
    : !jobReady
    ? 'Add a job description to score it against your verified experience.'
    : 'Open a job, review the fit score, and shortlist it to prepare an application.';

  const nextActionRoute = !profileReady ? '/profile' : '/(tabs)/jobs';

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header
        title="Job-Copilot"
        subtitle="Move from verified profile to a reviewed application"
        rightAction={
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => router.push('/profile')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="person-circle-outline" size={26} color={theme.colors.text} />
          </TouchableOpacity>
        }
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
      >
        {/* Next Step Hero Card */}
        <Card variant="raised" style={[styles.heroCard, { borderColor: theme.colors.primaryLight }]}>
          <View style={styles.heroTop}>
            <View style={[styles.heroBadge, { backgroundColor: theme.colors.primaryMuted }]}>
              <Text style={[styles.heroBadgeText, { color: theme.colors.primaryLight }]}>
                NEXT STEP
              </Text>
            </View>
          </View>
          <Text style={[styles.heroTitle, { color: theme.colors.text }]}>{nextActionTitle}</Text>
          <Text style={[styles.heroDesc, { color: theme.colors.textMuted }]}>{nextActionDesc}</Text>
          <Button
            title={profileReady ? 'Find a job' : 'Set up your profile'}
            onPress={() => router.push(nextActionRoute as any)}
            variant="primary"
            size="md"
            style={styles.heroBtn}
          />
        </Card>

        {/* Quick Stats Grid */}
        <View style={styles.statsRow}>
          <View style={[styles.statBox, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Text style={[styles.statValue, { color: theme.colors.success }]}>{verified}</Text>
            <Text style={[styles.statLabel, { color: theme.colors.textMuted }]}>Verified Facts</Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Text style={[styles.statValue, { color: theme.colors.text }]}>{jobs.length}</Text>
            <Text style={[styles.statLabel, { color: theme.colors.textMuted }]}>Jobs Tracked</Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Text style={[styles.statValue, { color: needsReview > 0 ? theme.colors.warning : theme.colors.primaryLight }]}>
              {needsReview}
            </Text>
            <Text style={[styles.statLabel, { color: theme.colors.textMuted }]}>Needs Review</Text>
          </View>
        </View>

        {/* 3 Step Flow */}
        <Text style={[styles.sectionHeading, { color: theme.colors.text }]}>Application Journey</Text>

        {/* Step 1 */}
        <Card onPress={() => router.push('/profile')}>
          <View style={styles.stepHeader}>
            <View style={[styles.stepNum, { backgroundColor: theme.colors.surfaceRaised }]}>
              <Text style={[styles.stepNumText, { color: theme.colors.primaryLight }]}>1</Text>
            </View>
            <View style={styles.stepInfo}>
              <Text style={[styles.stepTitle, { color: theme.colors.text }]}>Verify your profile</Text>
              <Text style={[styles.stepDesc, { color: theme.colors.textMuted }]}>
                Only verified facts can support generated application claims.
              </Text>
            </View>
          </View>
          <View style={styles.stepFooter}>
            <Text style={[styles.stepStat, { color: theme.colors.textMuted }]}>
              <Text style={{ fontWeight: '700', color: theme.colors.text }}>{verified}</Text> verified
              {proposed > 0 && (
                <Text style={{ color: theme.colors.warning }}> • {proposed} to review</Text>
              )}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
          </View>
        </Card>

        {/* Step 2 */}
        <Card onPress={() => router.push('/(tabs)/jobs')}>
          <View style={styles.stepHeader}>
            <View style={[styles.stepNum, { backgroundColor: theme.colors.surfaceRaised }]}>
              <Text style={[styles.stepNumText, { color: theme.colors.primaryLight }]}>2</Text>
            </View>
            <View style={styles.stepInfo}>
              <Text style={[styles.stepTitle, { color: theme.colors.text }]}>Review job fit</Text>
              <Text style={[styles.stepDesc, { color: theme.colors.textMuted }]}>
                Scores show which requirements your profile supports.
              </Text>
            </View>
          </View>
          <View style={styles.stepFooter}>
            <Text style={[styles.stepStat, { color: theme.colors.textMuted }]}>
              <Text style={{ fontWeight: '700', color: theme.colors.text }}>{jobs.length}</Text> jobs •{' '}
              <Text style={{ fontWeight: '700', color: theme.colors.text }}>{active}</Text> active
            </Text>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
          </View>
        </Card>

        {/* Step 3 */}
        <Card onPress={() => router.push('/(tabs)/applications')}>
          <View style={styles.stepHeader}>
            <View style={[styles.stepNum, { backgroundColor: theme.colors.surfaceRaised }]}>
              <Text style={[styles.stepNumText, { color: theme.colors.primaryLight }]}>3</Text>
            </View>
            <View style={styles.stepInfo}>
              <Text style={[styles.stepTitle, { color: theme.colors.text }]}>Prepare an application</Text>
              <Text style={[styles.stepDesc, { color: theme.colors.textMuted }]}>
                Generate cited content, review, and approve before applying.
              </Text>
            </View>
          </View>
          <View style={styles.stepFooter}>
            <Text style={[styles.stepStat, { color: theme.colors.textMuted }]}>
              <Text style={{ fontWeight: '700', color: needsReview > 0 ? theme.colors.warning : theme.colors.text }}>
                {needsReview}
              </Text>{' '}
              needing review
            </Text>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
          </View>
        </Card>
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
  headerBtn: {
    padding: 4,
  },
  heroCard: {
    padding: 20,
    marginBottom: 16,
  },
  heroTop: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  heroBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  heroBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 6,
  },
  heroDesc: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  heroBtn: {
    alignSelf: 'flex-start',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  statBox: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'center',
  },
  sectionHeading: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  stepNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  stepNumText: {
    fontSize: 14,
    fontWeight: '800',
  },
  stepInfo: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  stepDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  stepFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  stepStat: {
    fontSize: 13,
  },
});
