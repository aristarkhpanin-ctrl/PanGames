CREATE TABLE "buildings" (
	"id" text NOT NULL,
	"island_id" uuid NOT NULL,
	"type_id" text NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"z" integer NOT NULL,
	"rot" smallint DEFAULT 0 NOT NULL,
	"level" smallint DEFAULT 1 NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "buildings_island_id_id_pk" PRIMARY KEY("island_id","id")
);
--> statement-breakpoint
CREATE TABLE "friends" (
	"user_id" uuid NOT NULL,
	"friend_user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friends_user_id_friend_user_id_pk" PRIMARY KEY("user_id","friend_user_id")
);
--> statement-breakpoint
CREATE TABLE "gifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"island_id" uuid NOT NULL,
	"from_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"message_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "island_state" (
	"island_id" uuid PRIMARY KEY NOT NULL,
	"resources" jsonb NOT NULL,
	"world_patch" jsonb NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "islands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"seed" integer NOT NULL,
	"chapter" smallint DEFAULT 1 NOT NULL,
	"visit_code" text NOT NULL,
	"last_tick_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tick" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "islands_visit_code_unique" UNIQUE("visit_code")
);
--> statement-breakpoint
CREATE TABLE "journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"island_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"actors" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "villagers" (
	"id" text NOT NULL,
	"island_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "villagers_island_id_id_pk" PRIMARY KEY("island_id","id")
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"island_id" uuid NOT NULL,
	"guest_user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_island_id_islands_id_fk" FOREIGN KEY ("island_id") REFERENCES "public"."islands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends" ADD CONSTRAINT "friends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends" ADD CONSTRAINT "friends_friend_user_id_users_id_fk" FOREIGN KEY ("friend_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_island_id_islands_id_fk" FOREIGN KEY ("island_id") REFERENCES "public"."islands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "island_state" ADD CONSTRAINT "island_state_island_id_islands_id_fk" FOREIGN KEY ("island_id") REFERENCES "public"."islands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "islands" ADD CONSTRAINT "islands_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal" ADD CONSTRAINT "journal_island_id_islands_id_fk" FOREIGN KEY ("island_id") REFERENCES "public"."islands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "villagers" ADD CONSTRAINT "villagers_island_id_islands_id_fk" FOREIGN KEY ("island_id") REFERENCES "public"."islands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_island_id_islands_id_fk" FOREIGN KEY ("island_id") REFERENCES "public"."islands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_guest_user_id_users_id_fk" FOREIGN KEY ("guest_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "buildings_island_idx" ON "buildings" USING btree ("island_id");--> statement-breakpoint
CREATE INDEX "gifts_island_idx" ON "gifts" USING btree ("island_id","claimed");--> statement-breakpoint
CREATE INDEX "islands_owner_idx" ON "islands" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "journal_island_at_idx" ON "journal" USING btree ("island_id","at");--> statement-breakpoint
CREATE INDEX "login_tokens_email_idx" ON "login_tokens" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "villagers_island_idx" ON "villagers" USING btree ("island_id");--> statement-breakpoint
CREATE INDEX "visits_island_idx" ON "visits" USING btree ("island_id","at");