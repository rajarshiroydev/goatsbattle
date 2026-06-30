CREATE TABLE "battles" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_a" text NOT NULL,
	"entity_b" text NOT NULL,
	"category" text DEFAULT 'football' NOT NULL,
	"votes_a" integer DEFAULT 0 NOT NULL,
	"votes_b" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "elo_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"battle_id" text NOT NULL,
	"elo" integer NOT NULL,
	"delta" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"category" text DEFAULT 'football' NOT NULL,
	"country_code" text NOT NULL,
	"elo" integer DEFAULT 1500 NOT NULL,
	"votes_for" integer DEFAULT 0 NOT NULL,
	"votes_against" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"battle_id" text NOT NULL,
	"choice" text NOT NULL,
	"ip_hash" text NOT NULL,
	"country" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_entity_a_entities_id_fk" FOREIGN KEY ("entity_a") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_entity_b_entities_id_fk" FOREIGN KEY ("entity_b") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elo_history" ADD CONSTRAINT "elo_history_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elo_history" ADD CONSTRAINT "elo_history_battle_id_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_battle_id_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "elo_history_entity_idx" ON "elo_history" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "votes_ip_battle_uniq" ON "votes" USING btree ("ip_hash","battle_id");--> statement-breakpoint
CREATE INDEX "votes_battle_idx" ON "votes" USING btree ("battle_id");--> statement-breakpoint
CREATE INDEX "votes_country_idx" ON "votes" USING btree ("battle_id","country");