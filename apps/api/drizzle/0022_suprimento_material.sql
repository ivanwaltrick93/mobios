-- Suprimento do material: múltiplo de venda (caixa master, inteiro > 0, padrão 1) e leadtime em dias corridos
-- (inteiro >= 0, padrão 30). Os materiais existentes recebem os padrões.
ALTER TABLE "materiais" ADD COLUMN "multiplo" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "materiais" ADD COLUMN "leadtime_dias" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "materiais" ADD CONSTRAINT "materiais_multiplo_positivo" CHECK ("materiais"."multiplo" > 0);--> statement-breakpoint
ALTER TABLE "materiais" ADD CONSTRAINT "materiais_leadtime_positivo" CHECK ("materiais"."leadtime_dias" >= 0);