DROP INDEX "orcamentos_tenant_id_criado_em_index";--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "aniversario" smallint GENERATED ALWAYS AS ((extract(month from data_nascimento) * 100 + extract(day from data_nascimento))::smallint) STORED;--> statement-breakpoint
CREATE INDEX "clientes_aniversario" ON "clientes" USING btree ("tenant_id","aniversario") WHERE "clientes"."aniversario" is not null;--> statement-breakpoint
CREATE INDEX "orcamentos_lista" ON "orcamentos" USING btree ("tenant_id","criado_em" DESC NULLS FIRST,"numero" DESC NULLS FIRST);