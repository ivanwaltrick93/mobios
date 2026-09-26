import { zodResolver } from '@hookform/resolvers/zod';
import {
  aberturaOsInputSchema,
  formatarPlaca,
  type ClienteParaOrcamento,
  type OrdemServico,
  type VeiculoParaOrcamento,
} from '@mobios/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import type { z } from 'zod';
import { JanelaEscolhaCliente } from '../components/EscolhaCliente';
import { ClienteDoOrcamento } from '../components/Orcamento';
import { Alerta, AreaTexto, Botao, CabecalhoPagina, Campo, Cartao, Input, Secao, Select } from '../components/ui';
import { api } from '../lib/api';
import { aplicarErrosDaApi } from '../lib/formulario';
import { APOIO_OS, useVendedoresOs } from '../lib/ordensServico';
import { usePerfilOs, useSessao } from '../lib/sessao';

type Entrada = z.input<typeof aberturaOsInputSchema>;
type Saida = z.output<typeof aberturaOsInputSchema>;

/** Km digitado: vazio fica sem valor (a validação pede o km), senão número. */
const lerKm = (v: unknown) => (v === '' || v == null ? undefined : Number(v));

/**
 * Nova O.S. no balcão (OS-02): cliente e veículo, km de entrada e relato, e abrir. Fluxo curto para o atendente;
 * a API confere cliente ativo e completo, veículo do cliente, ativo e completo, e usa a tabela de preço padrão.
 */
export function NovaOrdemServico() {
  const perfil = usePerfilOs();
  const sessao = useSessao().data;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const vendedores = useVendedoresOs();
  const [cliente, setCliente] = useState<ClienteParaOrcamento | null>(null);
  const [escolhendo, setEscolhendo] = useState(false);
  const form = useForm<Entrada, unknown, Saida>({
    resolver: zodResolver(aberturaOsInputSchema),
    // O vendedor logado já vem como vendedor da O.S.
    defaultValues: {
      clienteId: '',
      veiculoId: '',
      relatoCliente: '',
      vendedorId: sessao?.vendedorId ?? '',
      previsaoEntrega: '',
    },
    mode: 'onTouched',
  });
  const erros = form.formState.errors;
  const veiculos = useQuery({
    queryKey: ['ordens-servico', 'apoio', 'veiculos', cliente?.id],
    queryFn: () => api<VeiculoParaOrcamento[]>(`${APOIO_OS}/clientes/${cliente!.id}/veiculos`),
    enabled: !!cliente,
  });
  const abrir = useMutation({
    mutationFn: (dados: Saida) => api<OrdemServico>('/ordens-servico', { method: 'POST', body: dados }),
    onSuccess: (os) => {
      queryClient.invalidateQueries({ queryKey: ['ordens-servico'] });
      queryClient.invalidateQueries({ queryKey: ['painel'] });
      navigate(`/os/${os.id}`, { replace: true });
    },
  });

  if (!perfil.podeAbrir) return <Alerta>Você não tem permissão para abrir O.S.</Alerta>;

  const escolher = (c: ClienteParaOrcamento) => {
    setCliente(c);
    setEscolhendo(false);
    form.setValue('clienteId', c.id, { shouldValidate: true });
    form.setValue('veiculoId', '');
  };

  return (
    <form noValidate onSubmit={form.handleSubmit((d) => abrir.mutate(d))} className="mx-auto max-w-3xl space-y-4">
      <CabecalhoPagina titulo="Nova O.S." subtitulo="Cliente, veículo, km de entrada e o que o cliente relatou." />
      <Alerta>{abrir.isError && aplicarErrosDaApi(abrir.error, form.setError)}</Alerta>

      <Cartao>
        <div className="space-y-4">
          <Secao titulo="Cliente e veículo">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-borda p-3">
              {cliente ? (
                <ClienteDoOrcamento cliente={cliente} />
              ) : (
                <span className="text-sm text-texto-suave">Nenhum cliente escolhido.</span>
              )}
              <Botao type="button" variante="secundario" onClick={() => setEscolhendo(true)}>
                <Search className="mr-1.5 size-4" aria-hidden /> {cliente ? 'Alterar' : 'Selecionar cliente'}
              </Botao>
            </div>
            {erros.clienteId?.message && <span className="text-xs text-perigo">{erros.clienteId.message}</span>}
            {escolhendo && (
              <JanelaEscolhaCliente apoio={APOIO_OS} aoEscolher={escolher} aoFechar={() => setEscolhendo(false)} />
            )}
            {cliente && (
              <Campo rotulo="Veículo *" erro={erros.veiculoId}>
                <Select {...form.register('veiculoId')}>
                  <option value="">Escolha o veículo</option>
                  {veiculos.data?.map((v) => (
                    <option key={v.id} value={v.id}>
                      {formatarPlaca(v.placa)} — {v.marca} {v.modelo}
                    </option>
                  ))}
                </Select>
              </Campo>
            )}
          </Secao>

          <Secao titulo="Recepção">
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo rotulo="Km de entrada *" erro={erros.kmEntrada}>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  {...form.register('kmEntrada', { setValueAs: lerKm })}
                />
              </Campo>
              <Campo rotulo="Previsão de entrega" erro={erros.previsaoEntrega}>
                <Input type="datetime-local" {...form.register('previsaoEntrega')} />
              </Campo>
              <Campo rotulo="Vendedor" erro={erros.vendedorId}>
                <Select {...form.register('vendedorId')}>
                  <option value="">Sem vendedor</option>
                  {vendedores.data?.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.nome}
                    </option>
                  ))}
                </Select>
              </Campo>
            </div>
            <Campo rotulo="Relato do cliente" erro={erros.relatoCliente}>
              <AreaTexto
                rows={3}
                placeholder="O que o cliente contou sobre o veículo"
                {...form.register('relatoCliente')}
              />
            </Campo>
          </Secao>
        </div>
      </Cartao>

      <div className="flex justify-end gap-2">
        <Botao type="button" variante="secundario" onClick={() => navigate('/os')}>
          Voltar
        </Botao>
        <Botao type="submit" disabled={abrir.isPending}>
          {abrir.isPending ? 'Abrindo…' : 'Abrir O.S.'}
        </Botao>
      </div>
    </form>
  );
}
