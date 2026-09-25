-- Novo cálculo do estoque (decisão do produto, 24/09/2026): disponível = tudo o que há no depósito, reservado é
-- parte dele e saldo = disponível − reservado. Os números gravados não mudam; só as linhas em que o reservado passa
-- do disponível (saldo negativo) têm o reservado zerado, com registro no histórico de ajustes.
INSERT INTO estoque_ajustes (
  tenant_id, material_id, deposito_id, disponivel_antes, disponivel_depois, reservado_antes, reservado_depois, motivo
)
SELECT tenant_id, material_id, deposito_id, disponivel, disponivel, reservado, 0,
  'Correção automática: o reservado era maior que o disponível (novo cálculo do saldo)'
FROM estoques
WHERE reservado > disponivel;
--> statement-breakpoint
UPDATE estoques SET reservado = 0, versao = versao + 1, atualizado_em = now() WHERE reservado > disponivel;
--> statement-breakpoint
ALTER TABLE "estoques" ADD CONSTRAINT "estoques_reservado_ate_disponivel" CHECK ("estoques"."reservado" <= "estoques"."disponivel");
