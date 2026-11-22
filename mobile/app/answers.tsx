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
import { Button } from '../src/components/Button';
import { Input } from '../src/components/Input';
import { LoadingState } from '../src/components/LoadingState';
import { ErrorState } from '../src/components/ErrorState';
import { EmptyState } from '../src/components/EmptyState';

export default function AnswersScreen() {
  const { theme } = useTheme();
  const queryClient = useQueryClient();

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingQuestion, setEditingQuestion] = useState('');
  const [editingAnswer, setEditingAnswer] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const answersQuery = useQuery({
    queryKey: ['answers'],
    queryFn: () => api.profile.getAnswers(),
  });

  const saveAnswerMutation = useMutation({
    mutationFn: () => {
      if (!editingKey) throw new Error('No answer selected');
      return api.profile.updateAnswer(editingKey, {
        question: editingQuestion,
        answer: editingAnswer.trim(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['answers'] });
      setEditingKey(null);
      setActionError(null);
    },
    onError: (err) => setActionError(formatErrorMessage(err)),
  });

  const answers = answersQuery.data || {};
  const entries = Object.entries(answers);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Header
        title="Answer Bank"
        subtitle="Reusable responses for common screening questions"
        showBack
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={answersQuery.isRefetching}
            onRefresh={() => answersQuery.refetch()}
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

        {answersQuery.isLoading && !answersQuery.isRefetching ? (
          <LoadingState count={3} />
        ) : answersQuery.isError ? (
          <ErrorState onRetry={() => answersQuery.refetch()} />
        ) : entries.length === 0 ? (
          <EmptyState
            icon="chatbubble-ellipses-outline"
            title="No answer bank entries"
            description="Responses to questions like notice period and work authorization will appear here."
          />
        ) : (
          entries.map(([key, item]) => (
            <Card key={key} style={styles.entryCard}>
              <View style={styles.entryTop}>
                <Text style={[styles.entryQuestion, { color: theme.colors.text }]}>
                  {item.question || key.replace(/_/g, ' ')}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setEditingKey(key);
                    setEditingQuestion(item.question || key);
                    setEditingAnswer(item.answer || '');
                  }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="pencil-outline" size={18} color={theme.colors.primaryLight} />
                </TouchableOpacity>
              </View>
              <Text style={[styles.entryAnswer, { color: theme.colors.textMuted }]}>
                {item.answer || 'Not answered yet'}
              </Text>
            </Card>
          ))
        )}
      </ScrollView>

      {/* Edit Answer Modal */}
      {editingKey && (
        <Modal visible={!!editingKey} animationType="slide" presentationStyle="pageSheet">
          <View style={[styles.modalRoot, { backgroundColor: theme.colors.background }]}>
            <Header
              title="Edit Answer"
              subtitle={editingQuestion}
              showBack
              onBack={() => setEditingKey(null)}
            />
            <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
              <Input
                label="Your Answer *"
                placeholder="Enter your response..."
                value={editingAnswer}
                onChangeText={setEditingAnswer}
                multiline
                numberOfLines={6}
              />
              <Button
                title="Save Answer"
                onPress={() => saveAnswerMutation.mutate()}
                loading={saveAnswerMutation.isPending}
                style={{ marginTop: 12 }}
              />
            </ScrollView>
          </View>
        </Modal>
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
  errorBox: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  entryCard: {
    marginBottom: 12,
  },
  entryTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  entryQuestion: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  entryAnswer: {
    fontSize: 14,
    lineHeight: 20,
  },
  modalRoot: {
    flex: 1,
  },
  modalContent: {
    padding: 16,
    paddingBottom: 40,
  },
});
