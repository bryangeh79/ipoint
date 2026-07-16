CREATE TYPE "public"."adjustment_action_type" AS ENUM('APPROVE', 'REJECT', 'EXECUTE');--> statement-breakpoint
CREATE TYPE "public"."adjustment_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED');--> statement-breakpoint
CREATE TYPE "public"."idempotency_status" AS ENUM('PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."ledger_direction" AS ENUM('CREDIT', 'DEBIT');--> statement-breakpoint
CREATE TYPE "public"."market_status" AS ENUM('ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."rule_status" AS ENUM('DRAFT', 'ACTIVE', 'RETIRED');--> statement-breakpoint
CREATE TYPE "public"."wallet_status" AS ENUM('ACTIVE', 'FROZEN', 'CLOSED');--> statement-breakpoint
CREATE TABLE "adjustment_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(48) NOT NULL,
	"request_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" "adjustment_action_type" NOT NULL,
	"reason" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adjustment_actions_public_id_key" UNIQUE("public_id"),
	CONSTRAINT "adjustment_actions_request_action_key" UNIQUE("request_id","action")
);
--> statement-breakpoint
CREATE TABLE "adjustment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(48) NOT NULL,
	"market_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"maker_id" uuid NOT NULL,
	"checker_id" uuid,
	"direction" "ledger_direction" NOT NULL,
	"amount" numeric(24, 8) NOT NULL,
	"reason" text NOT NULL,
	"status" "adjustment_status" DEFAULT 'PENDING' NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"executed_entry_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adjustment_requests_public_id_key" UNIQUE("public_id"),
	CONSTRAINT "adjustment_requests_idempotency_key_key" UNIQUE("idempotency_key"),
	CONSTRAINT "adjustment_requests_executed_entry_id_key" UNIQUE("executed_entry_id"),
	CONSTRAINT "adjustment_requests_amount_positive_check" CHECK ("adjustment_requests"."amount" > 0),
	CONSTRAINT "adjustment_requests_maker_checker_check" CHECK ("adjustment_requests"."checker_id" IS NULL OR "adjustment_requests"."maker_id" <> "adjustment_requests"."checker_id")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(48) NOT NULL,
	"market_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" varchar(96) NOT NULL,
	"entity_type" varchar(64) NOT NULL,
	"entity_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"request_id" varchar(96) NOT NULL,
	"occurred_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_public_id_key" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(48) NOT NULL,
	"scope" varchar(64) NOT NULL,
	"key" varchar(128) NOT NULL,
	"request_hash" char(64) NOT NULL,
	"status" "idempotency_status" DEFAULT 'PROCESSING' NOT NULL,
	"response_code" integer,
	"response_body" jsonb,
	"locked_until" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp (6) with time zone,
	CONSTRAINT "idempotency_records_public_id_key" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(48) NOT NULL,
	"wallet_id" uuid NOT NULL,
	"direction" "ledger_direction" NOT NULL,
	"amount" numeric(24, 8) NOT NULL,
	"entry_type" varchar(48) NOT NULL,
	"source_type" varchar(48) NOT NULL,
	"source_id" uuid NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"balance_after" numeric(24, 8) NOT NULL,
	"effective_at" timestamp (6) with time zone NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"reversal_of_entry_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "ledger_entries_public_id_key" UNIQUE("public_id"),
	CONSTRAINT "ledger_entries_wallet_idempotency_key" UNIQUE("wallet_id","idempotency_key"),
	CONSTRAINT "ledger_entries_source_once_key" UNIQUE("wallet_id","source_type","source_id","entry_type"),
	CONSTRAINT "ledger_entries_amount_positive_check" CHECK ("ledger_entries"."amount" > 0),
	CONSTRAINT "ledger_entries_reversal_not_self_check" CHECK ("ledger_entries"."reversal_of_entry_id" IS NULL OR "ledger_entries"."reversal_of_entry_id" <> "ledger_entries"."id")
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(32) NOT NULL,
	"code" varchar(16) NOT NULL,
	"currency" char(3) NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"status" "market_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_public_id_key" UNIQUE("public_id"),
	CONSTRAINT "markets_code_key" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "versioned_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(48) NOT NULL,
	"market_id" uuid NOT NULL,
	"rule_type" varchar(64) NOT NULL,
	"scope_key" varchar(128) NOT NULL,
	"version" integer NOT NULL,
	"status" "rule_status" DEFAULT 'DRAFT' NOT NULL,
	"effective_from" timestamp (6) with time zone NOT NULL,
	"effective_to" timestamp (6) with time zone,
	"payload" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "versioned_rules_public_id_key" UNIQUE("public_id"),
	CONSTRAINT "versioned_rules_scope_version_key" UNIQUE("market_id","rule_type","scope_key","version"),
	CONSTRAINT "versioned_rules_version_positive_check" CHECK ("versioned_rules"."version" > 0),
	CONSTRAINT "versioned_rules_effective_range_check" CHECK ("versioned_rules"."effective_to" IS NULL OR "versioned_rules"."effective_to" > "versioned_rules"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(40) NOT NULL,
	"market_id" uuid NOT NULL,
	"owner_type" varchar(32) NOT NULL,
	"owner_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"balance" numeric(24, 8) DEFAULT '0' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"status" "wallet_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_public_id_key" UNIQUE("public_id"),
	CONSTRAINT "wallets_market_owner_currency_key" UNIQUE("market_id","owner_type","owner_id","currency")
);
--> statement-breakpoint
ALTER TABLE "adjustment_actions" ADD CONSTRAINT "adjustment_actions_request_id_adjustment_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."adjustment_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_requests" ADD CONSTRAINT "adjustment_requests_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_requests" ADD CONSTRAINT "adjustment_requests_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reversal_of_entry_id_ledger_entries_id_fk" FOREIGN KEY ("reversal_of_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versioned_rules" ADD CONSTRAINT "versioned_rules_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adjustment_actions_request_created_idx" ON "adjustment_actions" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "adjustment_requests_market_status_idx" ON "adjustment_requests" USING btree ("market_id","status","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_market_actor_time_idx" ON "audit_events" USING btree ("market_id","actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_time_idx" ON "audit_events" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_scope_key_key" ON "idempotency_records" USING btree ("scope","key");--> statement-breakpoint
CREATE INDEX "idempotency_records_status_lock_idx" ON "idempotency_records" USING btree ("status","locked_until");--> statement-breakpoint
CREATE INDEX "ledger_entries_wallet_effective_idx" ON "ledger_entries" USING btree ("wallet_id","effective_at","id");--> statement-breakpoint
CREATE INDEX "versioned_rules_effective_idx" ON "versioned_rules" USING btree ("market_id","rule_type","scope_key","status","effective_from");--> statement-breakpoint
CREATE INDEX "wallets_market_status_idx" ON "wallets" USING btree ("market_id","status");