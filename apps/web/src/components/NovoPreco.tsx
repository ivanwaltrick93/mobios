import { zodResolver } from '@hookform/resolvers/zod';
import { hojeIso, mascaraMoeda, moedaParaCentavos, TIPOS_ITEM_PRECO, type TabelaPreco } from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, type UseFormSetError } from 'react-hook-form';
import { z } from 'zod';
import { api, ErroApi } from '../lib/api';
import { aplicarErrosDaApi } from '../lib/formulario';
import { Alerta, Botao, Campo, Cartao, Input, InputMascara, Select, TextoSuave } from './ui';

const novoPrecoSchema = z
  .object({
    item: z.enum(['material', 'servico']),
    /** SKU do material ou código do serviço. */
    codigo: z.string().trim().min(1, 'Informe o código'),
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
    'Vale nos dias em que nenhuma vigência cobre a data. Se o item já tiver preço padrão nesta tabela, ' +
    'ele é substituído (a troca fica no histórico).',
  vigencia: 'Começa hoje ou depois. A vigência atual é encerrada automaticamente na véspera; o passado não é alterado.',
};

/**
 * Preço digitando o SKU do material ou o código do serviço. A API confere se o item existe antes de gravar
 * (erro no próprio campo). Padrão = sem vigência (substitui o padrão atual da tabela); vigência = mesmas regras
 * da aba Preços do material ou do serviço.
 */
export function NovoPreco({ tabela, aoConcluir }: { tabela: TabelaPreco; aoConcluir: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<NovoPrecoForm>({
    resolver: zodResolver(novoPrecoSchema),
    defaultValues: { item: 'material', codigo: '', tipo: 'vigencia', preco: '', dataInicio: hojeIso(), dataFim: '' },
    mode: 'onTouched',
  });
  const tipo = form.watch('tipo');
  const item = form.watch('item');
  const salvar = useMutation({
    mutationFn: ({ item, codigo, tipo, preco, dataInicio, dataFim }: NovoPrecoForm) => {
      const base = {
        ...(item === 'material' ? { sku: codigo } : { servicoCodigo: codigo }),
        tabelaPrecoId: tabela.id,
        precoCentavos: moedaParaCentavos(preco),
      };
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
        <Alerta>{salvar.isError && mostrarErro(salvar.error, form.setError)}</Alerta>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Campo rotulo="Tipo *">
            <Select {...form.register('item')}>
              {Object.entries(TIPOS_ITEM_PRECO).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </Select>
          </Campo>
          <Campo rotulo={item === 'material' ? 'SKU *' : 'Código do serviço *'} erro={erros.codigo}>
            <Input autoFocus autoComplete="off" {...form.register('codigo')} />
          </Campo>
          <Campo
            rotulo="Preço (R$) *"
            dica={item === 'servico' ? 'No valor-hora: valor da hora' : undefined}
            erro={erros.preco}
          >
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

/** Erro da API: o código não encontrado (campo `sku` ou `servicoCodigo`) aparece no campo Código. */
function mostrarErro(erro: unknown, setError: UseFormSetError<NovoPrecoForm>) {
  if (erro instanceof ErroApi) {
    const codigo = erro.campos?.sku ?? erro.campos?.servicoCodigo;
    if (codigo) setError('codigo', { message: codigo });
  }
  return aplicarErrosDaApi(erro, setError);
}
