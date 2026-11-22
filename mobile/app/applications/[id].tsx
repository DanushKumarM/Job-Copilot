import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import { api, formatErrorMessage } from '../../src/api/client';
import { useTheme } from '../../src/hooks/useTheme';
import { Header } from '../../src/components/Header';
import { Card } from '../../src/components/Card';
import { Badge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/Input';
import { LoadingState } from '../../src/components/LoadingState';
import { ErrorState } from '../../src/components/ErrorState';
import { ConfirmModal } from '../../src/components/ConfirmModal';
import { AppStatus, ClaimDraft } from '../../src/types/api';
import { getSessionToken, removeSessionToken } from '../../src/utils/secureStore';
import { notifyAuthExpired } from '../../src/api/client';

export default function ApplicationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [activeDocKind, setActiveDocKind] = useState<'resume' | 'cover_letter' | 'answers'>('resume');
  const [editingClaim, setEditingClaim] = useState<ClaimDraft | null>(null);
  const [editedText, setEditedText] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [confirmTransition, setConfirmTransition] = useState<AppStatus | null>(null);
  const [transitionNote, setTransitionNote] = useState('');
  const [isPdfDownloading, setIsPdfDownloading] = useState(false);

  const appQuery = useQuery({
    queryKey: ['application', id],
    queryFn: () => api.applications.get(id),
    enabled: !!id,
  });

  const generateMutation = useMutation({
    mutationFn: (kind: 'resume' | 'summary' | 'answers' | 'cover_letter') =>
      api.applications.generateDocument(id, kind),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['application', id] });
      setActionError(null);
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
    },
    onError: (err) => setActionError(formatErrorMessage(err)),
  });

  const approveMutation = useMutation({
    mutationFn: (lockVersion: number) => api.applications.approve(id, lockVersion),
    onSuccess: (updated) => {
      queryClient.setQueryData(['application', id], updated);
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      setConfirmApprove(false);
      setActionError(null);
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
    },
    onError: (err) => {
      setConfirmApprove(false);
      setActionError(formatErrorMessage(err));
    },
  });

  const transitionMutation = useMutation({
    mutationFn: ({ target, lockVersion, note }: { target: AppStatus; lockVersion: number; note?: string }) =>
      api.applications.transition(id, target, lockVersion, note),
    onSuccess: (updated) => {
      queryClient.setQueryData(['application', id], updated);
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      setConfirmTransition(null);
      setTransitionNote('');
      setActionError(null);
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
    },
    onError: (err) => {
      setConfirmTransition(null);
      setActionError(formatErrorMessage(err));
    },
  });

  const saveClaimMutation = useMutation({
    mutationFn: async () => {
      if (!editingClaim || !appQuery.data) return;
      const doc = appQuery.data.documents[activeDocKind];
      const updatedClaims = (doc?.claims || []).map((c) =>
        c.id === editingClaim.id ? { ...c, claim_text: editedText } : c
      );
      await api.applications.saveDocument(id, activeDocKind, updatedClaims);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['application', id] });
      setEditingClaim(null);
      setEditedText('');
      setActionError(null);
    },
    onError: (err) => setActionError(formatErrorMessage(err)),
  });

  const handleDownloadPdf = async (kind: 'resume' | 'answers') => {
    setIsPdfDownloading(true);
    setActionError(null);
    try {
      const url = kind === 'resume'
        ? api.applications.getResumePdfUrl(id)
        : api.applications.getAnswersPdfUrl(id);

      const localFilename = `${kind}_${id.substring(0, 8)}.pdf`;
      const localUri = `${FileSystem.cacheDirectory}${localFilename}`;

      const token = await getSessionToken();
      if (!token) {
        notifyAuthExpired();
        throw new Error('Your session has expired. Please sign in again.');
      }

      const downloadResult = await FileSystem.downloadAsync(url, localUri, {
        headers: {
          Accept: 'application/pdf',
          Authorization: `Bearer ${token}`,
        },
      });
      if (downloadResult.status === 200) {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(downloadResult.uri, {
            mimeType: 'application/pdf',
            dialogTitle: `Share ${kind === 'resume' ? 'Resume' : 'Answers'} PDF`,
          });
        } else {
          Alert.alert('PDF Ready', `Saved to ${downloadResult.uri}`);
        }
      } else {
        if (downloadResult.status === 401) {
          await removeSessionToken();
          notifyAuthExpired();
          throw new Error('Your session has expired. Please sign in again.');
        }
        throw new Error(`Download failed with status ${downloadResult.status}`);
      }
    } catch (err: any) {
      setActionError(err.message || 'Could not download PDF. Server may still need LaTeX setup.');
    } finally {
      setIsPdfDownloading(false);
    }
  };

  if (appQuery.isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <Header title="Application Details" showBack />
        <LoadingState count={3} />
      </View>
    );
  }

  if (appQuery.isError || !appQuery.data) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <Header title="Application Details" showBack />
        <ErrorState onRetry={() => appQuery.refetch()} />
      </View>
    );
  }

  const app = appQuery.data;
  const currentDoc = app.documents?.[activeDocKind];
  const claims = currentDoc?.claims || [];

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header
        title={app.job_title}
        subtitle={`${app.company_name} • v${app.lock_version}`}
        showBack
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={appQuery.isRefetching}
            onRefresh={() => appQuery.refetch()}
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

        {/* Application Status & Summary */}
        <Card variant="raised" style={styles.heroCard}>
          <View style={styles.heroTop}>
            <View>
              <Text style={[styles.companyText, { color: theme.colors.textMuted }]}>
                {app.company_name}
              </Text>
              <Text style={[styles.jobTitleText, { color: theme.colors.text }]}>
                {app.job_title}
              </Text>
            </View>
            <Badge
              label={app.status.replace(/_/g, ' ')}
              variant={
                app.status === 'approved'
                  ? 'success'
                  : app.status === 'awaiting_approval'
                  ? 'warning'
                  : app.status.includes('rejected')
                  ? 'danger'
                  : 'primary'
              }
            />
          </View>

          {/* Action Row */}
          <View style={styles.buttonRow}>
            {app.status === 'awaiting_approval' && (
              <Button
                title="Approve Application"
                onPress={() => setConfirmApprove(true)}
                variant="primary"
                icon={<Ionicons name="checkmark-circle-outline" size={16} color="#FFFFFF" />}
                style={{ flex: 1 }}
              />
            )}
            <Button
              title="Resume PDF"
              onPress={() => handleDownloadPdf('resume')}
              loading={isPdfDownloading}
              variant="outline"
              size="sm"
              icon={<Ionicons name="download-outline" size={14} color={theme.colors.primaryLight} />}
            />
            <Button
              title="Answers PDF"
              onPress={() => handleDownloadPdf('answers')}
              loading={isPdfDownloading}
              variant="outline"
              size="sm"
              icon={<Ionicons name="download-outline" size={14} color={theme.colors.primaryLight} />}
            />
          </View>

          {/* Allowed Next Transitions */}
          {app.allowed_transitions && app.allowed_transitions.length > 0 && (
            <View style={styles.transitionsSection}>
              <Text style={[styles.transitionHeading, { color: theme.colors.textMuted }]}>
                Allowed next stage:
              </Text>
              <View style={styles.transitionPills}>
                {app.allowed_transitions.map((nextStatus) => (
                  <TouchableOpacity
                    key={nextStatus}
                    style={[
                      styles.transitionPill,
                      {
                        backgroundColor: theme.colors.surface,
                        borderColor: theme.colors.primary,
                      },
                    ]}
                    onPress={() => setConfirmTransition(nextStatus)}
                  >
                    <Ionicons name="arrow-forward-outline" size={12} color={theme.colors.primaryLight} />
                    <Text style={[styles.transitionPillText, { color: theme.colors.primaryLight }]}>
                      {nextStatus.replace(/_/g, ' ')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </Card>

        {/* Document Generation Tabs */}
        <View style={styles.docTabs}>
          {(['resume', 'cover_letter', 'answers'] as const).map((kind) => (
            <TouchableOpacity
              key={kind}
              onPress={() => setActiveDocKind(kind)}
              style={[
                styles.docTabBtn,
                activeDocKind === kind && {
                  borderBottomColor: theme.colors.primary,
                  borderBottomWidth: 2,
                },
              ]}
            >
              <Text
                style={[
                  styles.docTabText,
                  { color: activeDocKind === kind ? theme.colors.text : theme.colors.textMuted },
                ]}
              >
                {kind === 'resume' ? 'Resume Bullets' : kind === 'cover_letter' ? 'Cover Letter' : 'Screening Answers'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Generate Button for Active Document */}
        <View style={styles.generateBar}>
          <Button
            title={`Generate ${activeDocKind === 'resume' ? 'Bullets' : activeDocKind === 'cover_letter' ? 'Letter' : 'Answers'}`}
            onPress={() => generateMutation.mutate(activeDocKind)}
            loading={generateMutation.isPending}
            variant="secondary"
            size="sm"
            icon={<Ionicons name="sparkles-outline" size={14} color={theme.colors.text} />}
          />
        </View>

        {/* Claims / Document Content */}
        <View style={styles.claimsList}>
          {claims.length === 0 ? (
            <Card>
              <Text style={{ color: theme.colors.textMuted }}>
                No generated claims for this document yet. Tap Generate above.
              </Text>
            </Card>
          ) : (
            claims.map((claim, idx) => (
              <Card key={claim.id || idx} style={styles.claimCard}>
                <View style={styles.claimTop}>
                  <Text style={[styles.claimIndex, { color: theme.colors.primaryLight }]}>
                    #{idx + 1}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setEditingClaim(claim);
                      setEditedText(claim.claim_text);
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="pencil-outline" size={16} color={theme.colors.textMuted} />
                  </TouchableOpacity>
                </View>

                <Text style={[styles.claimText, { color: theme.colors.text }]}>
                  {claim.claim_text}
                </Text>

                {claim.citation_ids && claim.citation_ids.length > 0 && (
                  <View style={styles.citationRow}>
                    <Text style={[styles.citationLabel, { color: theme.colors.textSubtle }]}>
                      Citations:
                    </Text>
                    {claim.citation_ids.map((cid, ci) => (
                      <View key={ci} style={[styles.citationBadge, { backgroundColor: theme.colors.surfaceRaised }]}>
                        <Text style={[styles.citationText, { color: theme.colors.primaryLight }]}>
                          Fact {cid.substring(0, 6)}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {claim.issues && claim.issues.length > 0 && (
                  <View style={[styles.claimIssues, { backgroundColor: theme.colors.dangerMuted }]}>
                    {claim.issues.map((issue, ii) => (
                      <Text key={ii} style={{ color: theme.colors.danger, fontSize: 12 }}>
                        ⚠️ {issue}
                      </Text>
                    ))}
                  </View>
                )}
              </Card>
            ))
          )}
        </View>

        {/* Append-only History */}
        <Text style={[styles.sectionHeading, { color: theme.colors.text, marginTop: 24 }]}>
          Audit History
        </Text>
        {(!app.history || app.history.length === 0) ? (
          <Card>
            <Text style={{ color: theme.colors.textMuted }}>No history events recorded.</Text>
          </Card>
        ) : (
          <View style={styles.historyList}>
            {app.history.map((h, i) => (
              <View key={h.id || i} style={[styles.historyItem, { borderLeftColor: theme.colors.border }]}>
                <View style={[styles.historyDot, { backgroundColor: theme.colors.primary }]} />
                <View style={styles.historyContent}>
                  <Text style={[styles.historyToStatus, { color: theme.colors.text }]}>
                    {h.from_status ? `${h.from_status} → ` : 'Started as '}
                    <Text style={{ color: theme.colors.primaryLight }}>{h.to_status}</Text>
                  </Text>
                  <Text style={[styles.historyActor, { color: theme.colors.textMuted }]}>
                    by {h.actor} {h.note ? `• "${h.note}"` : ''}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Edit Claim Modal */}
      {editingClaim && (
        <ConfirmModal
          visible={!!editingClaim}
          title="Edit Claim"
          message="Claims must remain supported by verified profile facts."
          confirmText="Save Claim"
          onConfirm={() => saveClaimMutation.mutate()}
          loading={saveClaimMutation.isPending}
          onCancel={() => setEditingClaim(null)}
        />
      )}

      {/* Approve Confirmation Modal */}
      <ConfirmModal
        visible={confirmApprove}
        title="Approve Application"
        message="This will lock the current documents and transition the application to APPROVED."
        confirmText="Approve"
        confirmVariant="primary"
        loading={approveMutation.isPending}
        onConfirm={() => approveMutation.mutate(app.lock_version)}
        onCancel={() => setConfirmApprove(false)}
      />

      {/* Transition Confirmation Modal */}
      {confirmTransition && (
        <ConfirmModal
          visible={!!confirmTransition}
          title={`Move to ${confirmTransition.replace(/_/g, ' ')}`}
          message="Are you sure you want to transition this application to this stage?"
          confirmText="Transition"
          loading={transitionMutation.isPending}
          onConfirm={() =>
            transitionMutation.mutate({
              target: confirmTransition,
              lockVersion: app.lock_version,
              note: transitionNote || undefined,
            })
          }
          onCancel={() => setConfirmTransition(null)}
        />
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
    paddingBottom: 40,
  },
  errorBox: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  heroCard: {
    padding: 18,
    marginBottom: 16,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  companyText: {
    fontSize: 14,
    fontWeight: '500',
  },
  jobTitleText: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: 2,
    maxWidth: 240,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  transitionsSection: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  transitionHeading: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  transitionPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  transitionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  transitionPillText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  docTabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    marginBottom: 12,
  },
  docTabBtn: {
    paddingVertical: 10,
    marginRight: 16,
  },
  docTabText: {
    fontSize: 14,
    fontWeight: '600',
  },
  generateBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 12,
  },
  claimsList: {
    gap: 10,
  },
  claimCard: {
    marginBottom: 0,
  },
  claimTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  claimIndex: {
    fontSize: 12,
    fontWeight: '700',
  },
  claimText: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  citationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  citationLabel: {
    fontSize: 11,
  },
  citationBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  citationText: {
    fontSize: 11,
    fontWeight: '600',
  },
  claimIssues: {
    marginTop: 8,
    padding: 8,
    borderRadius: 6,
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  historyList: {
    paddingLeft: 8,
  },
  historyItem: {
    borderLeftWidth: 2,
    paddingLeft: 14,
    paddingBottom: 16,
    position: 'relative',
  },
  historyDot: {
    position: 'absolute',
    left: -6,
    top: 2,
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  historyContent: {
    marginTop: -2,
  },
  historyToStatus: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  historyActor: {
    fontSize: 11,
    marginTop: 2,
  },
});
