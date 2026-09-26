import {
  formatarPlaca,
  hojeIso,
  orcamentoInputSchema,
  somarDias,
  VALIDADE_MAXIMA_DIAS,
  VALIDADE_PADRAO_DIAS,
  type Orcamento,
  type VeiculoParaOrcamento,
} from '@mobios/shared';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import type { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { api } from '../lib/api';
import { useTabelasOrcamento, useVendedoresOrcamento } from '../lib/orcamentos';
import { usePerfilOrcamento } from '../lib/sessao';
import { CardCliente } from './ContextoCliente';
import { JanelaEscolhaCliente } from './EscolhaCliente';
import { AreaTexto, Botao, Campo, Input, Secao, Select } from './ui';

// Cabeçalho do orçamento (etapa Cliente): cliente, veículo, vendedor, tabela, validade e observações.

export const cabecalhoSchema = orcamentoInputSchema.omit({ itens: true, versao: true, automatico: true });
export type EntradaCabecalho = z.input<typeof cabecalhoSchema>;
export type SaidaCabecalho = z.output<typeof cabecalhoSchema>;

export const useVeiculosCliente = (clienteId: string | undefined) =>
  useQuery({
    queryKey: ['orcamentos', 'apoio', 'veiculos', clienteId],
    queryFn: () => api<VeiculoParaOrcamento[]>(`/orcamentos/apoio/clientes/${clienteId}/veiculos`),
    enabled: !!clienteId,
  });

/** Cliente escolhido: o suficiente para mostrar o nome com o alerta; o resto vem do contexto (CardCliente). */
export type ClienteEscolhido = { id: string; nome: string; ativo: boolean; pendencias: string[] };

export function CamposCabecalho({
  form,
  cliente,
  aoTrocarCliente,
  aoMudarTabela,
  vendedorAtualId,
  clienteFixo = false,
}: {
  form: ReturnType<typeof useForm<EntradaCabecalho, unknown, SaidaCabecalho>>;
  cliente: ClienteEscolhido | null;
  aoTrocarCliente: (c: ClienteEscolhido) => void;
  aoMudarTabela: (id: string) => void;
  vendedorAtualId?: string;
  /** Nova versão (2 em diante): o cliente é o do orçamento original. */
  clienteFixo?: boolean;
}) {
  const vendedores = useVendedoresOrcamento();
  const tabelas = useTabelasOrcamento();
  // Vendedor logado: o orçamento fica no nome dele (a API garante); só o Administrador escolhe.
  const { vendedorId: vendedorFixo } = usePerfilOrcamento();
  const [escolhendo, setEscolhendo] = useState(false);
  const veiculos = useVeiculosCliente(cliente?.id);
  const erros = form.formState.errors;
  const hoje = hojeIso();

  const semVeiculo = !form.watch('veiculoId');

  return (
    <div className="space-y-4">
      <Secao titulo="Cliente">
        {cliente ? (
          <CardCliente
            cliente={cliente}
            acao={
              clienteFixo ? (
                <span className="text-xs text-texto-suave">O cliente não muda a partir da versão 2</span>
              ) : (
                <Botao type="button" variante="secundario" onClick={() => setEscolhendo(true)}>
                  Alterar
                </Botao>
              )
            }
          />
        ) : (
          <div className="space-y-1">
            <Botao type="button" variante="secundario" onClick={() => setEscolhendo(true)}>
              <Search className="mr-1.5 size-4" aria-hidden /> Selecionar cliente
            </Botao>
            {erros.clienteId && <span className="block text-xs text-perigo">Escolha o cliente</span>}
          </div>
        )}
        {escolhendo && (
          <JanelaEscolhaCliente
            aoFechar={() => setEscolhendo(false)}
            aoEscolher={(c) => {
              setEscolhendo(false);
              aoTrocarCliente(c);
            }}
          />
        )}
        {cliente && (
          <div className="max-w-md">
            <Campo
              rotulo="Veículo"
              dica={semVeiculo ? 'Venda de peça sem aplicação em veículo' : undefined}
              erro={erros.veiculoId}
            >
              <Select {...form.register('veiculoId')}>
                <option value="">Sem veículo</option>
                {veiculos.data?.map((v) => (
                  <option key={v.id} value={v.id}>
                    {formatarPlaca(v.placa)} — {v.marca} {v.modelo}
                  </option>
                ))}
              </Select>
            </Campo>
          </div>
        )}
      </Secao>
      <Secao titulo="Dados comerciais">
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Campo rotulo="Vendedor *" erro={erros.vendedorId}>
            {vendedorFixo ? (
              <Input
                disabled
                aria-label="Vendedor"
                value={vendedores.data?.find((v) => v.id === vendedorFixo)?.nome ?? ''}
              />
            ) : (
              <Select {...form.register('vendedorId')}>
                <option value="">Escolha…</option>
                {vendedores.data
                  ?.filter((v) => v.ativo || v.id === vendedorAtualId)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.nome}
                      {v.ativo ? '' : ' (inativo)'}
                    </option>
                  ))}
              </Select>
            )}
          </Campo>
          <Campo rotulo="Tabela de preço *" erro={erros.tabelaPrecoId}>
            <Select value={String(form.watch('tabelaPrecoId') ?? '')} onChange={(e) => aoMudarTabela(e.target.value)}>
              {tabelas.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                  {t.padrao ? ' (padrão)' : ''}
                </option>
              ))}
            </Select>
          </Campo>
          <Campo
            rotulo="Validade"
            dica={`Vazio = ${VALIDADE_PADRAO_DIAS} dias a partir da emissão · máximo ${VALIDADE_MAXIMA_DIAS} dias`}
            erro={erros.validadeAte}
          >
            <Input
              type="date"
              min={hoje}
              max={somarDias(hoje, VALIDADE_MAXIMA_DIAS)}
              {...form.register('validadeAte')}
            />
          </Campo>
        </div>
      </Secao>
      <Secao titulo="Observações">
        <AreaTexto
          rows={2}
          maxLength={2000}
          aria-label="Observações"
          placeholder="Adicione uma observação comercial…"
          {...form.register('observacoes')}
        />
        {erros.observacoes?.message && <span className="text-xs text-perigo">{erros.observacoes.message}</span>}
      </Secao>
    </div>
  );
}

export const valoresDoOrcamento = (o?: Orcamento): EntradaCabecalho => ({
  clienteId: o?.cliente.id ?? '',
  veiculoId: o?.veiculo?.id ?? '',
  vendedorId: o?.vendedor.id ?? '',
  tabelaPrecoId: o?.tabela.id ?? '',
  validadeAte: o?.validadeAte ?? '',
  observacoes: o?.observacoes ?? '',
});
