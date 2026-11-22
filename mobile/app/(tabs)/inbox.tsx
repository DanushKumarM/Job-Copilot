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
import { api, formatErrorMessage } from '../../src/api/client';
import { useTheme } from '../../src/hooks/useTheme';
import { Header } from '../../src/components/Header';
import { Card } from '../../src/components/Card';
import { Badge } from '../../src/components/Badge';
import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/Input';
import { LoadingState } from '../../src/components/LoadingState';
import { ErrorState } from '../../src/components/ErrorState';
import { EmptyState } from '../../src/components/EmptyState';
import { ConfirmModal } from '../../src/components/ConfirmModal';
import { InboundMessage } from '../../src/types/api';

export default function InboxScreen() {
  const { theme } = useTheme();
  const queryClient = useQueryClient();

  const [actionError, setActionError] = useState<string | null>(null);
  const [importingMessage, setImportingMessage] = useState<InboundMessage | null>(null);
  const [importCompany, setImportCompany] = useState('');
  const [importTitle, setImportTitle] = useState('');
  const [importLocation, setImportLocation] = useState('');
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ['inbox-status'],
    queryFn: () => api.inbox.getStatus(),
  });

  const messagesQuery = useQuery({
    queryKey: ['inbox-messages'],
    queryFn: () => api.inbox.list(),
  });

  const syncMutation = useMutation({
    mutationFn: () => api.inbox.sync(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox-status'] });
      queryClient.invalidateQueries({ queryKey: ['inbox-messages'] });
      setActionError(null);
    },
    onError: (err) => setActionError(formatErrorMessage(err)),
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => api.inbox.dismiss(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox-messages'] });
      queryClient.invalidateQueries({ queryKey: ['inbox-status'] });
      setDismissingId(null);
    },
    onError: (err) => setActionError(formatErrorMessage(err)),
  });

  const importMutation = useMutation({
    mutationFn: () => {
      if (!importingMessage) throw new Error('No message selected');
      return api.inbox.import(importingMessage.id, {
        company: importCompany.trim(),
        title: importTitle.trim(),
        location: importLocation.trim() || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox-messages'] });
      queryClient.invalidateQueries({ queryKey: ['inbox-status'] });
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      setImportingMessage(null);
      setImportCompany('');
      setImportTitle('');
      setImportLocation('');
    },
    onError: (err) => setActionError(formatErrorMessage(err)),
  });

  const onRefresh = () => {
    statusQuery.refetch();
    messagesQuery.refetch();
  };

  const isRefreshing = statusQuery.isRefetching || messagesQuery.isRefetching;
  const status = statusQuery.data;
  const messages = messagesQuery.data || [];

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header
        title="Inbound Messages"
        subtitle={
          status?.gmail_connected
            ? `Gmail connected • ${messages.length} unresolved`
            : 'Gmail not connected server-side'
        }
        rightAction={
          <Button
            title="Sync"
            onPress={() => syncMutation.mutate()}
            loading={syncMutation.isPending}
            size="sm"
            icon={<Ionicons name="sync-outline" size={16} color="#FFFFFF" />}
          />
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
        {actionError && (
          <View style={[styles.errorBox, { backgroundColor: theme.colors.dangerMuted }]}>
            <Text style={{ color: theme.colors.danger, fontSize: 13 }}>{actionError}</Text>
          </View>
        )}

        {/* Gmail status banner */}
        {!status?.gmail_connected && (
          <Card style={[styles.infoBanner, { borderColor: theme.colors.warning }]}>
            <View style={styles.bannerRow}>
              <Ionicons name="information-circle" size={20} color={theme.colors.warning} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.bannerTitle, { color: theme.colors.warning }]}>
                  Gmail Setup Pending
                </Text>
                <Text style={[styles.bannerDesc, { color: theme.colors.textMuted }]}>
                  Gmail is configured on the backend with OAuth. Once connected, incoming job alerts and ATS updates sync automatically.
                </Text>
              </View>
            </View>
          </Card>
        )}

        {messagesQuery.isLoading && !messagesQuery.isRefetching ? (
          <LoadingState count={3} />
        ) : messagesQuery.isError ? (
          <ErrorState onRetry={onRefresh} />
        ) : messages.length === 0 ? (
          <EmptyState
            icon="mail-unread-outline"
            title="No unresolved messages"
            description="Your inbox is up to date. Tap Sync to check for new interview invitations and job status updates."
            actionTitle="Sync Now"
            onAction={() => syncMutation.mutate()}
          />
        ) : (
          messages.map((msg) => {
            const classVariant =
              msg.classification === 'interview'
                ? 'success'
                : msg.classification === 'rejection'
                ? 'danger'
                : msg.classification === 'confirmation'
                ? 'primary'
                : 'neutral';

            return (
              <Card key={msg.id} style={styles.messageCard}>
                <View style={styles.msgTop}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={[styles.msgSender, { color: theme.colors.textMuted }]} numberOfLines={1}>
                      {msg.sender}
                    </Text>
                    <Text style={[styles.msgSubject, { color: theme.colors.text }]}>
                      {msg.subject}
                    </Text>
                  </View>
                  <Badge
                    label={`${msg.classification} (${Math.round(msg.confidence * 100)}%)`}
                    variant={classVariant}
                  />
                </View>

                {msg.extracted && (msg.extracted.company || msg.extracted.title) && (
                  <View style={[styles.extractedBox, { backgroundColor: theme.colors.surfaceRaised }]}>
                    <Text style={[styles.extractedText, { color: theme.colors.textMuted }]}>
                      Detected: {msg.extracted.company || 'Unknown Company'} • {msg.extracted.title || 'Role'}
                    </Text>
                  </View>
                )}

                <View style={styles.msgActions}>
                  <Button
                    title="Import Application"
                    onPress={() => {
                      setImportingMessage(msg);
                      setImportCompany(msg.extracted?.company || '');
                      setImportTitle(msg.extracted?.title || '');
                    }}
                    variant="primary"
                    size="sm"
                    style={{ flex: 1 }}
                  />
                  <Button
                    title="Dismiss"
                    onPress={() => setDismissingId(msg.id)}
                    variant="outline"
                    size="sm"
                  />
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>

      {/* Import Modal */}
      {importingMessage && (
        <Modal visible={!!importingMessage} animationType="slide" presentationStyle="pageSheet">
          <View style={[styles.modalRoot, { backgroundColor: theme.colors.background }]}>
            <Header
              title="Import Application"
              subtitle="Add off-system application found in email"
              showBack
              onBack={() => setImportingMessage(null)}
            />
            <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
              <Input
                label="Company Name *"
                placeholder="e.g. Acme Corp"
                value={importCompany}
                onChangeText={setImportCompany}
              />
              <Input
                label="Job Title *"
                placeholder="e.g. Software Engineer"
                value={importTitle}
                onChangeText={setImportTitle}
              />
              <Input
                label="Location"
                placeholder="e.g. Bengaluru / Remote"
                value={importLocation}
                onChangeText={setImportLocation}
              />

              <Button
                title="Confirm Import"
                onPress={() => importMutation.mutate()}
                loading={importMutation.isPending}
                style={{ marginTop: 12 }}
              />
            </ScrollView>
          </View>
        </Modal>
      )}

      {/* Dismiss Confirm */}
      <ConfirmModal
        visible={!!dismissingId}
        title="Dismiss Message"
        message="This message will be removed from your unresolved queue."
        confirmText="Dismiss"
        onConfirm={() => dismissingId && dismissMutation.mutate(dismissingId)}
        loading={dismissMutation.isPending}
        onCancel={() => setDismissingId(null)}
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
    paddingBottom: 32,
  },
  errorBox: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  infoBanner: {
    marginBottom: 16,
  },
  bannerRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  bannerDesc: {
    fontSize: 12,
    lineHeight: 18,
  },
  messageCard: {
    marginBottom: 12,
  },
  msgTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  msgSender: {
    fontSize: 12,
    marginBottom: 2,
  },
  msgSubject: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  extractedBox: {
    padding: 8,
    borderRadius: 6,
    marginBottom: 10,
  },
  extractedText: {
    fontSize: 12,
  },
  msgActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  modalRoot: {
    flex: 1,
  },
  modalContent: {
    padding: 16,
    paddingBottom: 40,
  },
});
