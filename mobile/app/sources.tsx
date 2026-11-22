import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api, formatErrorMessage } from '../src/api/client';
import { useTheme } from '../src/hooks/useTheme';
import { Header } from '../src/components/Header';
import { Card } from '../src/components/Card';
import { Badge } from '../src/components/Badge';
import { Button } from '../src/components/Button';
import { Input } from '../src/components/Input';
import { LoadingState } from '../src/components/LoadingState';
import { ErrorState } from '../src/components/ErrorState';
import { EmptyState } from '../src/components/EmptyState';
import { SourceOut } from '../src/types/api';

export default function SourcesScreen() {
  const { theme } = useTheme();
  const queryClient = useQueryClient();

  const [isAddModal, setIsAddModal] = useState(false);
  const [kind, setKind] = useState<'greenhouse' | 'lever'>('greenhouse');
  const [boardToken, setBoardToken] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const sourcesQuery = useQuery({
    queryKey: ['sources'],
    queryFn: () => api.sources.list(),
  });

  const addSourceMutation = useMutation({
    mutationFn: () =>
      api.sources.create({
        kind,
        config: { board_token: boardToken.trim() },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      setIsAddModal(false);
      setBoardToken('');
      setActionError(null);
    },
    onError: (err) => setActionError(formatErrorMessage(err)),
  });

  const pollMutation = useMutation({
    mutationFn: (sourceId: string) => api.sources.poll(sourceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setActionError(null);
    },
    onError: (err) => setActionError(formatErrorMessage(err)),
  });

  const sources = sourcesQuery.data || [];

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header
        title="Job Boards & Sources"
        subtitle="ATS sources crawled automatically"
        showBack
        rightAction={
          <Button
            title="Add Board"
            onPress={() => setIsAddModal(true)}
            size="sm"
            icon={<Ionicons name="add" size={16} color="#FFFFFF" />}
          />
        }
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={sourcesQuery.isRefetching}
            onRefresh={() => sourcesQuery.refetch()}
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

        {sourcesQuery.isLoading && !sourcesQuery.isRefetching ? (
          <LoadingState count={3} />
        ) : sourcesQuery.isError ? (
          <ErrorState onRetry={() => sourcesQuery.refetch()} />
        ) : sources.length === 0 ? (
          <EmptyState
            icon="globe-outline"
            title="No job boards connected"
            description="Add a Greenhouse or Lever board token to automatically ingest open positions."
            actionTitle="Add Job Board"
            onAction={() => setIsAddModal(true)}
          />
        ) : (
          sources.map((source) => (
            <Card key={source.id} style={styles.sourceCard}>
              <View style={styles.sourceTop}>
                <View>
                  <Text style={[styles.sourceKind, { color: theme.colors.text }]}>
                    {source.kind.toUpperCase()}
                  </Text>
                  <Text style={[styles.boardToken, { color: theme.colors.textMuted }]}>
                    Token: {source.config?.board_token || 'Manual'}
                  </Text>
                </View>
                <Badge
                  label={source.health || 'ok'}
                  variant={source.health === 'ok' ? 'success' : 'danger'}
                />
              </View>

              <View style={styles.sourceMeta}>
                <Text style={[styles.metaText, { color: theme.colors.textSubtle }]}>
                  Basis: {source.access_basis}
                </Text>
                {source.last_polled_at && (
                  <Text style={[styles.metaText, { color: theme.colors.textSubtle }]}>
                    Last poll: {new Date(source.last_polled_at).toLocaleDateString()}
                  </Text>
                )}
              </View>

              <View style={styles.sourceActions}>
                <Button
                  title="Poll Now"
                  onPress={() => pollMutation.mutate(source.id)}
                  loading={pollMutation.isPending && pollMutation.variables === source.id}
                  variant="outline"
                  size="sm"
                  icon={<Ionicons name="sync-outline" size={14} color={theme.colors.primaryLight} />}
                />
              </View>
            </Card>
          ))
        )}
      </ScrollView>

      {/* Add Board Modal */}
      <Modal visible={isAddModal} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modalRoot, { backgroundColor: theme.colors.background }]}>
          <Header
            title="Connect Job Board"
            subtitle="Add a Greenhouse or Lever board to poll"
            showBack
            onBack={() => setIsAddModal(false)}
          />
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Text style={[styles.fieldLabel, { color: theme.colors.text }]}>Platform</Text>
            <View style={styles.platformRow}>
              {(['greenhouse', 'lever'] as const).map((p) => (
                <TouchableOpacity
                  key={p}
                  onPress={() => setKind(p)}
                  style={[
                    styles.platformBtn,
                    {
                      backgroundColor: kind === p ? theme.colors.primary : theme.colors.surface,
                      borderColor: kind === p ? theme.colors.primary : theme.colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.platformText, { color: kind === p ? '#FFFFFF' : theme.colors.textMuted }]}>
                    {p}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input
              label="Board Token *"
              placeholder="e.g. stripe, figma, coinbase"
              value={boardToken}
              onChangeText={setBoardToken}
              autoCapitalize="none"
              hint="The subdomain or identifier from boards.greenhouse.io/<token> or jobs.lever.co/<token>"
            />

            <Button
              title="Connect Board"
              onPress={() => addSourceMutation.mutate()}
              loading={addSourceMutation.isPending}
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
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  errorBox: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  sourceCard: {
    marginBottom: 12,
  },
  sourceTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  sourceKind: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 2,
  },
  boardToken: {
    fontSize: 13,
  },
  sourceMeta: {
    marginBottom: 12,
    gap: 4,
  },
  metaText: {
    fontSize: 12,
  },
  sourceActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 8,
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
  platformRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  platformBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  platformText: {
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
});
