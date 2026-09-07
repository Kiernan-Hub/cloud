ALTER TABLE "gate_results" DROP CONSTRAINT "gate_results_gate_id_gates_id_fk";
--> statement-breakpoint
ALTER TABLE "gate_results" ALTER COLUMN "gate_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gate_results" ADD CONSTRAINT "gate_results_gate_id_gates_id_fk" FOREIGN KEY ("gate_id") REFERENCES "public"."gates"("id") ON DELETE set null ON UPDATE no action;