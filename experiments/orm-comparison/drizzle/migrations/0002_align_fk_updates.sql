ALTER TABLE "adjustment_actions" DROP CONSTRAINT "adjustment_actions_request_id_adjustment_requests_id_fk";
--> statement-breakpoint
ALTER TABLE "adjustment_requests" DROP CONSTRAINT "adjustment_requests_market_id_markets_id_fk";
--> statement-breakpoint
ALTER TABLE "adjustment_requests" DROP CONSTRAINT "adjustment_requests_wallet_id_wallets_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_market_id_markets_id_fk";
--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_wallet_id_wallets_id_fk";
--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_reversal_of_entry_id_ledger_entries_id_fk";
--> statement-breakpoint
ALTER TABLE "versioned_rules" DROP CONSTRAINT "versioned_rules_market_id_markets_id_fk";
--> statement-breakpoint
ALTER TABLE "wallets" DROP CONSTRAINT "wallets_market_id_markets_id_fk";
--> statement-breakpoint
ALTER TABLE "adjustment_actions" ADD CONSTRAINT "adjustment_actions_request_id_adjustment_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."adjustment_requests"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "adjustment_requests" ADD CONSTRAINT "adjustment_requests_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "adjustment_requests" ADD CONSTRAINT "adjustment_requests_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reversal_of_entry_id_ledger_entries_id_fk" FOREIGN KEY ("reversal_of_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "versioned_rules" ADD CONSTRAINT "versioned_rules_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE cascade;