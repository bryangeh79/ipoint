-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "market_status" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "wallet_status" AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ledger_direction" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "adjustment_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED');

-- CreateEnum
CREATE TYPE "adjustment_action_type" AS ENUM ('APPROVE', 'REJECT', 'EXECUTE');

-- CreateEnum
CREATE TYPE "rule_status" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "idempotency_status" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "markets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_id" VARCHAR(32) NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "status" "market_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "markets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_id" VARCHAR(40) NOT NULL,
    "market_id" UUID NOT NULL,
    "owner_type" VARCHAR(32) NOT NULL,
    "owner_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "balance" DECIMAL(24,8) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "status" "wallet_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_id" VARCHAR(48) NOT NULL,
    "wallet_id" UUID NOT NULL,
    "direction" "ledger_direction" NOT NULL,
    "amount" DECIMAL(24,8) NOT NULL,
    "entry_type" VARCHAR(48) NOT NULL,
    "source_type" VARCHAR(48) NOT NULL,
    "source_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "balance_after" DECIMAL(24,8) NOT NULL,
    "effective_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversal_of_entry_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjustment_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_id" VARCHAR(48) NOT NULL,
    "market_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "maker_id" UUID NOT NULL,
    "checker_id" UUID,
    "direction" "ledger_direction" NOT NULL,
    "amount" DECIMAL(24,8) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "adjustment_status" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" VARCHAR(128) NOT NULL,
    "executed_entry_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adjustment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjustment_actions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_id" VARCHAR(48) NOT NULL,
    "request_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" "adjustment_action_type" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adjustment_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_id" VARCHAR(48) NOT NULL,
    "market_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" VARCHAR(96) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "request_id" VARCHAR(96) NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "versioned_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_id" VARCHAR(48) NOT NULL,
    "market_id" UUID NOT NULL,
    "rule_type" VARCHAR(64) NOT NULL,
    "scope_key" VARCHAR(128) NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "rule_status" NOT NULL DEFAULT 'DRAFT',
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_to" TIMESTAMPTZ(6),
    "payload" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "versioned_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_id" VARCHAR(48) NOT NULL,
    "scope" VARCHAR(64) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status" "idempotency_status" NOT NULL DEFAULT 'PROCESSING',
    "response_code" INTEGER,
    "response_body" JSONB,
    "locked_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "markets_public_id_key" ON "markets"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "markets_code_key" ON "markets"("code");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_public_id_key" ON "wallets"("public_id");

-- CreateIndex
CREATE INDEX "wallets_market_status_idx" ON "wallets"("market_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_market_owner_currency_key" ON "wallets"("market_id", "owner_type", "owner_id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_public_id_key" ON "ledger_entries"("public_id");

-- CreateIndex
CREATE INDEX "ledger_entries_wallet_effective_idx" ON "ledger_entries"("wallet_id", "effective_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_wallet_idempotency_key" ON "ledger_entries"("wallet_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_source_once_key" ON "ledger_entries"("wallet_id", "source_type", "source_id", "entry_type");

-- CreateIndex
CREATE UNIQUE INDEX "adjustment_requests_public_id_key" ON "adjustment_requests"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "adjustment_requests_idempotency_key_key" ON "adjustment_requests"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "adjustment_requests_executed_entry_id_key" ON "adjustment_requests"("executed_entry_id");

-- CreateIndex
CREATE INDEX "adjustment_requests_market_status_idx" ON "adjustment_requests"("market_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "adjustment_actions_public_id_key" ON "adjustment_actions"("public_id");

-- CreateIndex
CREATE INDEX "adjustment_actions_request_created_idx" ON "adjustment_actions"("request_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "adjustment_actions_request_action_key" ON "adjustment_actions"("request_id", "action");

-- CreateIndex
CREATE UNIQUE INDEX "audit_events_public_id_key" ON "audit_events"("public_id");

-- CreateIndex
CREATE INDEX "audit_events_market_actor_time_idx" ON "audit_events"("market_id", "actor_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_entity_time_idx" ON "audit_events"("entity_type", "entity_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "versioned_rules_public_id_key" ON "versioned_rules"("public_id");

-- CreateIndex
CREATE INDEX "versioned_rules_effective_idx" ON "versioned_rules"("market_id", "rule_type", "scope_key", "status", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "versioned_rules_scope_version_key" ON "versioned_rules"("market_id", "rule_type", "scope_key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_public_id_key" ON "idempotency_records"("public_id");

-- CreateIndex
CREATE INDEX "idempotency_records_status_lock_idx" ON "idempotency_records"("status", "locked_until");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_key_key" ON "idempotency_records"("scope", "key");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reversal_of_entry_id_fkey" FOREIGN KEY ("reversal_of_entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_requests" ADD CONSTRAINT "adjustment_requests_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_requests" ADD CONSTRAINT "adjustment_requests_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_requests" ADD CONSTRAINT "adjustment_requests_executed_entry_id_fkey" FOREIGN KEY ("executed_entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_actions" ADD CONSTRAINT "adjustment_actions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "adjustment_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versioned_rules" ADD CONSTRAINT "versioned_rules_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
