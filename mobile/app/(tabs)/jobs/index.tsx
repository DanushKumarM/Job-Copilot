import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Modal,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, formatErrorMessage } from '../../../src/api/client';
import { useTheme } from '../../../src/hooks/useTheme';
import { Header } from '../../../src/components/Header';
import { Card } from '../../../src/components/Card';
import { Badge } from '../../../src/components/Badge';
import { Input } from '../../../src/components/Input';
import { Button } from '../../../src/components/Button';
import { FilterTabs } from '../../../src/components/FilterTabs';
import { LoadingState } from '../../../src/components/LoadingState';
import { ErrorState } from '../../../src/components/ErrorState';
import { EmptyState } from '../../../src/components/EmptyState';
import { JobSummary } from '../../../src/types/api';

type JobSegment = 'all' | 'worth_look' | 'applying' | 'filtered_out';
type SortOrder = 'fit' | 'recent';

export default function JobsScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState<JobSegment>('all');
  const [sortBy, setSortBy] = useState<SortOrder>('fit');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Add Job Form State
  const [newTitle, setNewTitle] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newWorkMode, setNewWorkMode] = useState<'remote' | 'hybrid' | 'onsite'>('remote');
  const [newUrl, setNewUrl] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.jobs.list(),
  });

  const addJobMutation = useMutation({
    mutationFn: (body: any) => api.jobs.create(body),
    onSuccess: (newJob) => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setIsAddModalOpen(false);
      resetForm();
      router.push(`/jobs/${newJob.id}` as any);
    },
    onError: (err) => {
      setFormError(formatErrorMessage(err));
    },
  });

  const resetForm = () => {
    setNewTitle('');
    setNewCompany('');
    setNewLocation('');
    setNewWorkMode('remote');
    setNewUrl('');
    setNewDescription('');
    setFormError(null);
  };

  const handleAddJob = () => {
    setFormError(null);
    if (!newTitle.trim() || !newCompany.trim() || !newDescription.trim()) {
      setFormError('Please enter title, company, and job description.');
      return;
    }
    addJobMutation.mutate({
      title: newTitle.trim(),
      company: newCompany.trim(),
      location: newLocation.trim() || undefined,
      work_mode: newWorkMode,
      posting_url: newUrl.trim() || undefined,
      description: newDescription.trim(),
    });
  };

  const filteredJobs = useMemo(() => {
    let list = jobsQuery.data || [];

    // Search query
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (j) =>
          j.title.toLowerCase().includes(q) ||
          j.company_name.toLowerCase().includes(q) ||
          (j.location && j.location.toLowerCase().includes(q))
      );
    }

    // Segment filter
    if (segment === 'worth_look') {
      list = list.filter((j) => (j.overall_fit || 0) >= 0.6);
    } else if (segment === 'applying') {
      list = list.filter((j) => !!j.application_status);
    } else if (segment === 'filtered_out') {
      list = list.filter(
        (j) => (j.overall_fit || 0) < 0.4 || j.application_status === 'rejected_by_rules'
      );
    }

    // Sort
    return [...list].sort((a, b) => {
      if (sortBy === 'fit') {
        return (b.overall_fit || 0) - (a.overall_fit || 0);
      }
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
  }, [jobsQuery.data, search, segment, sortBy]);

  const renderJobItem = ({ item }: { item: JobSummary }) => {
    const fitPercent = Math.round((item.overall_fit || 0) * 100);
    const fitVariant = fitPercent >= 75 ? 'success' : fitPercent >= 50 ? 'primary' : 'neutral';

    return (
      <Card onPress={() => router.push(`/jobs/${item.id}` as any)}>
        <View style={styles.cardTop}>
          <View style={styles.titleInfo}>
            <Text style={[styles.jobTitle, { color: theme.colors.text }]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={[styles.companyName, { color: theme.colors.textMuted }]}>
              {item.company_name}
            </Text>
          </View>
          <Badge
            label={`${fitPercent}% fit`}
            variant={fitVariant}
            style={styles.fitBadge}
          />
        </View>

        <View style={styles.cardMeta}>
          {item.location && (
            <View style={styles.metaItem}>
              <Ionicons name="location-outline" size={13} color={theme.colors.textMuted} />
              <Text style={[styles.metaText, { color: theme.colors.textMuted }]}>
                {item.location}
              </Text>
            </View>
          )}
          {item.work_mode && (
            <View style={styles.metaItem}>
              <Ionicons name="briefcase-outline" size={13} color={theme.colors.textMuted} />
              <Text style={[styles.metaText, { color: theme.colors.textMuted, textTransform: 'capitalize' }]}>
                {item.work_mode}
              </Text>
            </View>
          )}
          {item.freshness && (
            <View style={styles.metaItem}>
              <Ionicons name="time-outline" size={13} color={theme.colors.textMuted} />
              <Text style={[styles.metaText, { color: theme.colors.textMuted }]}>
                {item.freshness}
              </Text>
            </View>
          )}
        </View>

        {item.application_status && (
          <View style={styles.statusRow}>
            <Badge
              label={item.application_status.replace(/_/g, ' ')}
              variant={item.application_status.includes('rejected') ? 'danger' : 'primary'}
            />
          </View>
        )}
      </Card>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header
        title="Jobs"
        subtitle={`${filteredJobs.length} roles found`}
        rightAction={
          <Button
            title="Add job"
            onPress={() => setIsAddModalOpen(true)}
            size="sm"
            icon={<Ionicons name="add" size={16} color="#FFFFFF" />}
          />
        }
      />

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <Input
          placeholder="Search by title, company, location..."
          value={search}
          onChangeText={setSearch}
          containerStyle={{ marginBottom: 0 }}
        />
      </View>

      {/* Segments & Sort */}
      <FilterTabs<JobSegment>
        tabs={[
          { id: 'all', label: 'All' },
          { id: 'worth_look', label: 'Worth a look' },
          { id: 'applying', label: 'Applying' },
          { id: 'filtered_out', label: 'Filtered out' },
        ]}
        activeTab={segment}
        onTabChange={setSegment}
      />

      <View style={styles.sortRow}>
        <TouchableOpacity
          style={styles.sortToggle}
          onPress={() => setSortBy(sortBy === 'fit' ? 'recent' : 'fit')}
        >
          <Ionicons name="swap-vertical" size={14} color={theme.colors.primaryLight} />
          <Text style={[styles.sortText, { color: theme.colors.primaryLight }]}>
            Sorted by: {sortBy === 'fit' ? 'Best fit' : 'Recently seen'}
          </Text>
        </TouchableOpacity>
      </View>

      {jobsQuery.isLoading && !jobsQuery.isRefetching ? (
        <LoadingState count={4} />
      ) : jobsQuery.isError ? (
        <ErrorState onRetry={() => jobsQuery.refetch()} />
      ) : filteredJobs.length === 0 ? (
        <EmptyState
          icon="search-outline"
          title="No jobs found"
          description={search ? 'No jobs match your current search.' : 'Add a job description to score fit.'}
          actionTitle="Add a job"
          onAction={() => setIsAddModalOpen(true)}
        />
      ) : (
        <FlatList
          data={filteredJobs}
          keyExtractor={(item) => item.id}
          renderItem={renderJobItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={jobsQuery.isRefetching}
              onRefresh={() => jobsQuery.refetch()}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }
        />
      )}

      {/* Add Job Modal */}
      <Modal
        visible={isAddModalOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setIsAddModalOpen(false)}
      >
        <View style={[styles.modalRoot, { backgroundColor: theme.colors.background }]}>
          <Header
            title="Add a Job"
            subtitle="Paste a job posting to evaluate fit"
            showBack
            onBack={() => setIsAddModalOpen(false)}
          />

          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            {formError && (
              <View style={[styles.modalError, { backgroundColor: theme.colors.dangerMuted }]}>
                <Text style={{ color: theme.colors.danger, fontSize: 13 }}>{formError}</Text>
              </View>
            )}

            <Input
              label="Job Title *"
              placeholder="e.g. Senior Backend Engineer"
              value={newTitle}
              onChangeText={setNewTitle}
            />

            <Input
              label="Company *"
              placeholder="e.g. Stripe"
              value={newCompany}
              onChangeText={setNewCompany}
            />

            <Input
              label="Location"
              placeholder="e.g. Bengaluru, India or Remote"
              value={newLocation}
              onChangeText={setNewLocation}
            />

            <Text style={[styles.fieldLabel, { color: theme.colors.text }]}>Work Mode</Text>
            <View style={styles.workModeRow}>
              {(['remote', 'hybrid', 'onsite'] as const).map((mode) => (
                <TouchableOpacity
                  key={mode}
                  onPress={() => setNewWorkMode(mode)}
                  style={[
                    styles.workModeBtn,
                    {
                      backgroundColor: newWorkMode === mode ? theme.colors.primary : theme.colors.surface,
                      borderColor: newWorkMode === mode ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.workModeText,
                      { color: newWorkMode === mode ? '#FFFFFF' : theme.colors.textMuted },
                    ]}
                  >
                    {mode}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input
              label="Posting URL"
              placeholder="https://..."
              value={newUrl}
              onChangeText={setNewUrl}
              autoCapitalize="none"
              keyboardType="url"
            />

            <Input
              label="Job Description *"
              placeholder="Paste full job description, requirements, responsibilities..."
              value={newDescription}
              onChangeText={setNewDescription}
              multiline
              numberOfLines={8}
            />

            <Button
              title="Save & Evaluate Job"
              onPress={handleAddJob}
              loading={addJobMutation.isPending}
              style={{ marginTop: 12 }}
            />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  sortRow: {
    paddingHorizontal: 16,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  sortToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
  },
  sortText: {
    fontSize: 12,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  titleInfo: {
    flex: 1,
    marginRight: 10,
  },
  jobTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  companyName: {
    fontSize: 14,
    fontWeight: '500',
  },
  fitBadge: {
    alignSelf: 'flex-start',
  },
  cardMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 4,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
  },
  statusRow: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  modalRoot: {
    flex: 1,
  },
  modalScroll: {
    padding: 16,
    paddingBottom: 40,
  },
  modalError: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  workModeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  workModeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  workModeText: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
});
