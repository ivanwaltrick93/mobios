import { zodResolver } from '@hookform/resolvers/zod';
import { hojeIso, mascaraMoeda, moedaParaCentavos, type TabelaPreco } from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api } from '../lib/api';
import { aplicarErrosDaApi } from '../lib/formulario';
import { Alerta, Botao, Campo, Cartao, Input, InputMascara, TextoSuave } from './ui';

const novoPrecoSchema = z
  .object({
    sku: z.string().trim().min(1, 'Informe o SKU'),
    tipo: z.enum(['padrao', 'vigencia']),
    preco: z.string().refine((v) => moedaParaCentavos(v) != null, 'Informe o preço'),
    dataInicio: z.string(),
    dataFim: z.string(),
  })
  .refine((d) => d.tipo === 'padrao' || d.dataInicio, {
    message: 'Informe o início da vigência',
    path: ['dataInicio'],
  })
  .refine((d) => d.tipo === 'padrao' || !d.dataFim || d.dataFim >= d.dataInicio, {
    message: 'O fim deve ser igual ou posterior ao início',
    path: ['dataFim'],
  });
type NovoPrecoForm = z.infer<typeof novoPrecoSchema>;

const EXPLICACAO: Record<NovoPrecoForm['tipo'], string> = {
  padrao:
    'Vale nos dias em que nenhuma vigência cobre a data. Se o material já tiver preço padrão nesta tabela, ' +
    'ele é substituído (a troca fica no histórico).',
  vigencia: 'Começa hoje ou depois. A vigência atual é encerrada automaticamente na véspera; o passado não é alterado.',
};

/**
 * Preço digitando o SKU. A API confere se o SKU existe antes de gravar (erro no próprio campo).
 * Padrão = sem vigência (substitui o padrão atual da tabela); vigência = mesmas regras da tela do material.
 */
export function NovoPreco({ tabela, aoConcluir }: { tabela: TabelaPreco; aoConcluir: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<NovoPrecoForm>({
    resolver: zodResolver(novoPrecoSchema),
    defaultValues: { sku: '', tipo: 'vigencia', preco: '', dataInicio: hojeIso(), dataFim: '' },
    mode: 'onTouched',
  });
  const tipo = form.watch('tipo');
  const salvar = useMutation({
    mutationFn: ({ sku, tipo, preco, dataInicio, dataFim }: NovoPrecoForm) => {
      const base = { sku, tabelaPrecoId: tabela.id, precoCentavos: moedaParaCentavos(preco) };
      return tipo === 'padrao'
        ? api('/precos/padrao', { method: 'PUT', body: base })
        : api('/precos', { method: 'POST', body: { ...base, dataInicio, dataFim: dataFim || null } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linhas-preco'] });
      queryClient.invalidateQueries({ queryKey: ['tabelas-preco'] });
      queryClient.invalidateQueries({ queryKey: ['precos'] });
      aoConcluir();
    },
  });
  const erros = form.formState.errors;

  return (
    <Cartao className="p-5">
      <form noValidate onSubmit={form.handleSubmit((d) => salvar.mutate(d))} className="space-y-4">
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" value="vigencia" {...form.register('tipo')} /> Com vigência (período)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" value="padrao" {...form.register('tipo')} /> Padrão (sem vigência)
          </label>
        </div>
        <TextoSuave className="text-xs">{EXPLICACAO[tipo]}</TextoSuave>
        <Alerta>{salvar.isError && aplicarErrosDaApi(salvar.error, form.setError)}</Alerta>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Campo rotulo="SKU *" erro={erros.sku}>
            <Input autoFocus autoComplete="off" {...form.register('sku')} />
          </Campo>
          <Campo rotulo="Preço (R$) *" erro={erros.preco}>
            <InputMascara
              inputMode="numeric"
              placeholder="0,00"
              registro={form.register('preco')}
              mascara={mascaraMoeda}
            />
          </Campo>
          {tipo === 'vigencia' && (
            <>
              <Campo rotulo="Início da vigência *" dica="Hoje ou depois" erro={erros.dataInicio}>
                <Input type="date" min={hojeIso()} {...form.register('dataInicio')} />
              </Campo>
              <Campo rotulo="Fim da vigência" dica="Vazio = sem data de fim" erro={erros.dataFim}>
                <Input type="date" {...form.register('dataFim')} />
              </Campo>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Botao type="submit" disabled={salvar.isPending}>
            {salvar.isPending ? 'Salvando…' : 'Salvar preço'}
          </Botao>
          <Botao type="button" variante="secundario" onClick={aoConcluir}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Cartao>
  );
}
