import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Modal,
  Alert,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { api, formatErrorMessage } from '../src/api/client';
import { useTheme } from '../src/hooks/useTheme';
import { Header } from '../src/components/Header';
import { Card } from '../src/components/Card';
import { Badge } from '../src/components/Badge';
import { Button } from '../src/components/Button';
import { Input } from '../src/components/Input';
import { FilterTabs } from '../src/components/FilterTabs';
import { LoadingState } from '../src/components/LoadingState';
import { ErrorState } from '../src/components/ErrorState';
import { EmptyState } from '../src/components/EmptyState';
import { ConfirmModal } from '../src/components/ConfirmModal';
import { FactKind, FactStatus, ProfileFact } from '../src/types/api';

type FactFilter = 'proposed' | 'verified' | 'rejected' | 'all';

export default function ProfileScreen() {
  const { theme } = useTheme();
  const queryClient = useQueryClient();

  const [activeFilter, setActiveFilter] = useState<FactFilter>('proposed');
  const [actionError, setActionError] = useState<string | null>(null);

  // Modals state
  const [isAddFactModal, setIsAddFactModal] = useState(false);
  const [newKind, setNewKind] = useState<FactKind>('skill');
  const [newStatement, setNewStatement] = useState('');

  const [isPasteResumeModal, setIsPasteResumeModal] = useState(false);
  const [resumeText, setResumeText] = useState('');

  const [revisingFact, setRevisingFact] = useState<ProfileFact | null>(null);
  const [revisedStatement, setRevisedStatement] = useState('');

  const [rejectingFactId, setRejectingFactId] = useState<string | null>(null);

  const factsQuery = useQuery({
    queryKey: ['facts'],
    queryFn: () => api.profile.getFacts(),
  });

  const verifyMutation = useMutation({
    mutationFn: (id: string) => api.profile.verifyFact(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['facts'] });
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
    },
    onError: (err) => setActionError(formatErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.profile.rejectFact(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['facts'] });
      setRejectingFactId(null);
    },
    onError: (err) => {
      setRejectingFactId(null);
      setActionError(formatErrorMessage(err));
    },
  });

  const reviseMutation = useMutation({
    mutationFn: () => {
      if (!revisingFact) throw new Error('No fact selected');
      return api.profile.reviseFact(revisingFact.id, revisedStatement.trim());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['facts'] });
      setRevisingFact(null);
      setRevisedStatement('');
    },
    onError: (err) => setActionError(formatErrorMessage(err)),
  });

  const addFactMutation = useMutation({
    mutationFn: () => api.profile.addFact({ kind: newKind, statement: newStatement.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['facts'] });
      setIsAddFactModal(false);
      setNewStatement('');
    },
    onError: (err) => setActionError(formatErrorMessage(err)),
  });

  const importResumeMutation = useMutation({
    mutationFn: (text: string) => api.profile.importResumeText(text),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['facts'] });
      setIsPasteResumeModal(false);
      setResumeText('');
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
    },
    onError: (err) => setActionError(formatErrorMessage(err)),
  });

  const uploadResumeMutation = useMutation({
    mutationFn: async () => {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/plain'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const file = result.assets[0];
      return api.profile.uploadResumeFile(file.uri, file.name, file.mimeType || 'application/pdf');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['facts'] });
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
    },
    onError: (err) => setActionError(formatErrorMessage(err)),
  });

  const facts = factsQuery.data || [];

  const verifiedCount = facts.filter((f) => f.status === 'verified').length;
  const proposedCount = facts.filter((f) => f.status === 'proposed').length;
  const rejectedCount = facts.filter((f) => f.status === 'rejected').length;

  const filteredFacts = useMemo(() => {
    if (activeFilter === 'all') return facts;
    return facts.filter((f) => f.status === activeFilter);
  }, [facts, activeFilter]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header
        title="Profile Facts"
        subtitle={`${verifiedCount} verified • ${proposedCount} to review`}
        showBack
        rightAction={
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Button
              title="Add"
              onPress={() => setIsAddFactModal(true)}
              size="sm"
              icon={<Ionicons name="add" size={16} color="#FFFFFF" />}
            />
          </View>
        }
      />

      {/* Action buttons: Import text or PDF */}
      <View style={styles.importActionBar}>
        <Button
          title="Paste Resume"
          onPress={() => setIsPasteResumeModal(true)}
          variant="secondary"
          size="sm"
          style={{ flex: 1 }}
          icon={<Ionicons name="clipboard-outline" size={14} color={theme.colors.text} />}
        />
        <Button
          title="Upload Resume PDF"
          onPress={() => uploadResumeMutation.mutate()}
          loading={uploadResumeMutation.isPending}
          variant="secondary"
          size="sm"
          style={{ flex: 1 }}
          icon={<Ionicons name="cloud-upload-outline" size={14} color={theme.colors.text} />}
        />
      </View>

      {/* Filter Tabs */}
      <FilterTabs<FactFilter>
        tabs={[
          { id: 'proposed', label: 'Proposed', badge: proposedCount },
          { id: 'verified', label: 'Verified', badge: verifiedCount },
          { id: 'rejected', label: 'Rejected', badge: rejectedCount },
          { id: 'all', label: 'All', badge: facts.length },
        ]}
        activeTab={activeFilter}
        onTabChange={setActiveFilter}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={factsQuery.isRefetching}
            onRefresh={() => factsQuery.refetch()}
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

        {factsQuery.isLoading && !factsQuery.isRefetching ? (
          <LoadingState count={4} />
        ) : factsQuery.isError ? (
          <ErrorState onRetry={() => factsQuery.refetch()} />
        ) : filteredFacts.length === 0 ? (
          <EmptyState
            icon="document-text-outline"
            title="No facts in this view"
            description={
              activeFilter === 'proposed'
                ? 'No pending facts to review. Import a resume to extract facts.'
                : 'No facts match the selected status.'
            }
            actionTitle="Paste Resume Text"
            onAction={() => setIsPasteResumeModal(true)}
          />
        ) : (
          filteredFacts.map((fact) => {
            const isProposed = fact.status === 'proposed';
            const isVerified = fact.status === 'verified';
            const isRejected = fact.status === 'rejected';

            return (
              <Card key={fact.id} style={styles.factCard}>
                <View style={styles.factTop}>
                  <Badge
                    label={fact.kind.replace(/_/g, ' ')}
                    variant="neutral"
                  />
                  <Badge
                    label={fact.status}
                    variant={
                      isVerified
                        ? 'success'
                        : isProposed
                        ? 'warning'
                        : isRejected
                        ? 'danger'
                        : 'neutral'
                    }
                  />
                </View>

                <Text style={[styles.statementText, { color: theme.colors.text }]}>
                  {fact.statement}
                </Text>

                {/* Actions: Verify / Reject / Revise */}
                <View style={styles.factActions}>
                  {isProposed && (
                    <>
                      <Button
                        title="Verify"
                        onPress={() => verifyMutation.mutate(fact.id)}
                        loading={verifyMutation.isPending && verifyMutation.variables === fact.id}
                        variant="primary"
                        size="sm"
                        style={{ flex: 1 }}
                        icon={<Ionicons name="checkmark" size={14} color="#FFFFFF" />}
                      />
                      <Button
                        title="Reject"
                        onPress={() => setRejectingFactId(fact.id)}
                        variant="outline"
                        size="sm"
                        style={{ flex: 1 }}
                      />
                    </>
                  )}
                  <Button
                    title="Revise"
                    onPress={() => {
                      setRevisingFact(fact);
                      setRevisedStatement(fact.statement);
                    }}
                    variant="ghost"
                    size="sm"
                    icon={<Ionicons name="create-outline" size={14} color={theme.colors.textMuted} />}
                  />
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>

      {/* Add Fact Modal */}
      <Modal visible={isAddFactModal} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modalRoot, { backgroundColor: theme.colors.background }]}>
          <Header
            title="Add Profile Fact"
            subtitle="Add a verifiable statement about your experience"
            showBack
            onBack={() => setIsAddFactModal(false)}
          />
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Text style={[styles.fieldLabel, { color: theme.colors.text }]}>Category</Text>
            <View style={styles.kindSelector}>
              {(['skill', 'work_experience', 'education', 'project'] as FactKind[]).map((k) => (
                <TouchableOpacity
                  key={k}
                  onPress={() => setNewKind(k)}
                  style={[
                    styles.kindBtn,
                    {
                      backgroundColor: newKind === k ? theme.colors.primary : theme.colors.surface,
                      borderColor: newKind === k ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.kindText, { color: newKind === k ? '#FFFFFF' : theme.colors.textMuted }]}>
                    {k.replace(/_/g, ' ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input
              label="Statement *"
              placeholder="e.g. 4+ years architecting microservices with Python and FastAPI."
              value={newStatement}
              onChangeText={setNewStatement}
              multiline
              numberOfLines={4}
            />

            <Button
              title="Save Fact"
              onPress={() => addFactMutation.mutate()}
              loading={addFactMutation.isPending}
              style={{ marginTop: 12 }}
            />
          </ScrollView>
        </View>
      </Modal>

      {/* Paste Resume Modal */}
      <Modal visible={isPasteResumeModal} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modalRoot, { backgroundColor: theme.colors.background }]}>
          <Header
            title="Import Resume"
            subtitle="Paste your resume text to extract candidate facts"
            showBack
            onBack={() => setIsPasteResumeModal(false)}
          />
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Input
              label="Resume Text *"
              placeholder="Paste plain text of your resume..."
              value={resumeText}
              onChangeText={setResumeText}
              multiline
              numberOfLines={12}
            />

            <Button
              title="Parse & Extract Facts"
              onPress={() => importResumeMutation.mutate(resumeText)}
              loading={importResumeMutation.isPending}
              style={{ marginTop: 12 }}
            />
          </ScrollView>
        </View>
      </Modal>

      {/* Revise Fact Modal */}
      {revisingFact && (
        <Modal visible={!!revisingFact} animationType="slide" presentationStyle="pageSheet">
          <View style={[styles.modalRoot, { backgroundColor: theme.colors.background }]}>
            <Header
              title="Revise Fact"
              subtitle="Revising supersedes this fact with a new version"
              showBack
              onBack={() => setRevisingFact(null)}
            />
            <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
              <Input
                label="Updated Statement *"
                value={revisedStatement}
                onChangeText={setRevisedStatement}
                multiline
                numberOfLines={5}
              />
              <Button
                title="Save Revision"
                onPress={() => reviseMutation.mutate()}
                loading={reviseMutation.isPending}
                style={{ marginTop: 12 }}
              />
            </ScrollView>
          </View>
        </Modal>
      )}

      {/* Confirm Reject */}
      <ConfirmModal
        visible={!!rejectingFactId}
        title="Reject Fact"
        message="This fact will be marked as rejected and excluded from all future claim generation."
        confirmText="Reject Fact"
        confirmVariant="danger"
        loading={rejectMutation.isPending}
        onConfirm={() => rejectingFactId && rejectMutation.mutate(rejectingFactId)}
        onCancel={() => setRejectingFactId(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  importActionBar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  errorBox: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  factCard: {
    marginBottom: 10,
  },
  factTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  statementText: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  factActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  modalRoot: {
    flex: 1,
  },
  modalContent: {
    padding: 16,
    paddingBottom: 40,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  kindSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  kindBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  kindText: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
});
