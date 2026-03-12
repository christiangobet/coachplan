// src/lib/plan-chat-types.ts
// Shared types for chat messages, change log, and proposal state.
// These mirror the Prisma JSON fields — keep in sync with spec.

import type { PlanAdjustmentProposal } from './plan-editor';

export type ChatMessageRole = 'athlete' | 'coach' | 'system';
export type ProposalState = 'active' | 'applied' | 'superseded';

export interface MessageMetadata {
  proposal?: PlanAdjustmentProposal;
  state?: ProposalState;
  changeLogIds?: string[];
  // For system messages that describe a move
  moveDescription?: string;
}

export interface DaySnapshot {
  dayId: string;
  activities: Array<{
    id: string;
    type: string;
    subtype: string | null;
    title: string;
    duration: number | null;
    distance: number | null;
    distanceUnit: string | null;
    priority: string | null;
  }>;
}

export interface ChatMessage {
  id: string;
  planId: string;
  role: ChatMessageRole;
  content: string;
  metadata: MessageMetadata | null;
  createdAt: string; // ISO string
}
