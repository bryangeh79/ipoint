/**
 * Agent Activation Lifecycle — Local Domain Types
 *
 * Persistence-bound types and repository interfaces for the
 * agent activation lifecycle service.
 *
 * @packageDocumentation
 */

import type {
  AgentActivationAction,
  AgentActivationAuditEntry,
  AgentActivationRecord,
  AgentActivationStatus,
  ActivationFeeConfig,
} from '@ipoint/types';

/* ------------------------------------------------------------------ */
/*  Repository Interface                                               */
/* ------------------------------------------------------------------ */

/**
 * Repository contract for AgentActivation persistence.
 * Implementations handle the database-specific storage.
 */
export interface AgentActivationRepository {
  /**
   * Find an activation record by its ID.
   */
  findById(id: string): Promise<AgentActivationRecord | null>;

  /**
   * Find an activation record by member ID and market.
   * Each member-market combination has at most one activation record.
   */
  findByMemberAndMarket(
    memberId: string,
    market: string,
  ): Promise<AgentActivationRecord | null>;

  /**
   * Find all activation records matching optional filters.
   */
  findMany(
    filters?: AgentActivationFilter,
  ): Promise<{ items: AgentActivationRecord[]; total: number }>;

  /**
   * Check if a member already has an activation record in a market.
   */
  exists(memberId: string, market: string): Promise<boolean>;

  /**
   * Insert a new activation record.
   */
  insert(record: AgentActivationRecord): Promise<AgentActivationRecord>;

  /**
   * Update an existing activation record (optimistic concurrency).
   */
  update(record: AgentActivationRecord): Promise<AgentActivationRecord>;

  /**
   * Insert an audit log entry for a status transition.
   */
  insertAuditEntry(
    entry: AgentActivationAuditEntry,
  ): Promise<AgentActivationAuditEntry>;

  /**
   * Find audit log entries for a specific activation record.
   */
  findAuditEntries(activationId: string): Promise<AgentActivationAuditEntry[]>;
}

/* ------------------------------------------------------------------ */
/*  Filter                                                             */
/* ------------------------------------------------------------------ */

export interface AgentActivationFilter {
  memberId?: string;
  market?: string;
  status?: AgentActivationStatus;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

/* ------------------------------------------------------------------ */
/*  Fee Configuration Store Interface                                  */
/* ------------------------------------------------------------------ */

/**
 * Interface for retrieving market-specific activation fee configuration.
 * Defaults are frozen in domain types but can be overridden per market.
 */
export interface ActivationFeeConfigStore {
  /**
   * Get activation fee configuration for a market.
   * Returns the default if no market-specific config is stored.
   */
  getFeeConfig(market: string): Promise<ActivationFeeConfig>;

  /**
   * Upsert activation fee configuration for a market.
   */
  setFeeConfig(config: ActivationFeeConfig): Promise<void>;

  /**
   * Get all configured fee configurations.
   */
  getAllFeeConfigs(): Promise<ActivationFeeConfig[]>;
}

/* ------------------------------------------------------------------ */
/*  Transition Context                                                 */
/* ------------------------------------------------------------------ */

/**
 * Context passed through transition operations, carrying actor info.
 */
export interface TransitionContext {
  /** Admin user ID performing the action (null for self-service) */
  actorAdminUserId: string | null;
  /** Type of actor performing the transition */
  actorType: 'SYSTEM' | 'ADMIN' | 'MEMBER';
  /** Reason or notes for the transition */
  reason: string | null;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Create Activation DTO                                              */
/* ------------------------------------------------------------------ */

export interface CreateActivationDto {
  memberId: string;
  market: string;
}

export type { AgentActivationRecord, ActivationFeeConfig };
