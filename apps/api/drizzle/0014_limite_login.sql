CREATE TABLE "login_tentativas" (
	"chave" text PRIMARY KEY NOT NULL,
	"falhas" integer NOT NULL,
	"janela_inicio" timestamp with time zone NOT NULL,
	"bloqueado_ate" timestamp with time zone,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "login_tentativas_atualizado_em_index" ON "login_tentativas" USING btree ("atualizado_em");