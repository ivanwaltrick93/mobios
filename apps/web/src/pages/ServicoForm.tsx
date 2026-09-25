import { zodResolver } from '@hookform/resolvers/zod';
import {
  formatarCodigoServico,
  formatarHoras,
  FORMAS_PRECO_SERVICO,
  mascaraHoras,
  servicoInputSchema,
  type Servico,
} from '@mobios/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router';
import type { z } from 'zod';
import {
  Alerta,
  AreaTexto,
  Botao,
  Campo,
  Cartao,
  Input,
  InputMascara,
  Select,
  TextoSuave,
  Titulo,
} from '../components/ui';
import { api } from '../lib/api';
import { useOpcoes } from '../lib/cadastro';
import { aplicarErrosDaApi } from '../lib/formulario';
import { usePode } from '../lib/sessao';

type Entrada = z.input<typeof servicoInputSchema>;
type Saida = z.output<typeof servicoInputSchema>;

const valoresIniciais = (s?: Servico): Entrada => ({
  nome: s?.nome ?? '',
  descricao: s?.descricao ?? '',
  formaPreco: s?.formaPreco ?? 'fechado',
  tempoMinutos: s?.tempoMinutos != null ? formatarHoras(s.tempoMinutos) : '',
  observacao: s?.observacao ?? '',
  classificacaoId: s?.classificacaoId ?? '',
  garantiaDias: s?.garantiaDias != null ? String(s.garantiaDias) : '',
  garantiaKm: s?.garantiaKm != null ? String(s.garantiaKm) : '',
});

/** Cadastro e edição do serviço (tela única: poucos campos). Na edição, a versão protege contra sobrescrita. */
function ServicoForm({ servico, aoSalvar }: { servico?: Servico; aoSalvar: (s: Servico) => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const classificacoes = useOpcoes('classificacoesServico');
  const form = useForm<Entrada, unknown, Saida>({
    resolver: zodResolver(servicoInputSchema),
    defaultValues: valoresIniciais(servico),
    mode: 'onTouched',
  });
  const salvar = useMutation({
    mutationFn: (dados: Saida) =>
      api<Servico>(servico ? `/servicos/${servico.id}` : '/servicos', {
        method: servico ? 'PUT' : 'POST',
        body: { ...dados, versao: servico?.versao },
      }),
    onSuccess: (salvo) => {
      queryClient.invalidateQueries({ queryKey: ['servicos'] });
      queryClient.invalidateQueries({ queryKey: ['opcoes'] });
      aoSalvar(salvo);
    },
  });
  const erros = form.formState.errors;
  const porHora = form.watch('formaPreco') === 'hora';

  return (
    <form className="space-y-5" noValidate onSubmit={form.handleSubmit((d) => salvar.mutate(d))}>
      <Alerta>{salvar.isError && aplicarErrosDaApi(salvar.error, form.setError)}</Alerta>
      <div className="grid gap-4 md:grid-cols-4">
        <Campo rotulo="Código">
          <Input value={servico ? formatarCodigoServico(servico.codigo) : 'Gerado ao salvar'} disabled />
        </Campo>
        <div className="md:col-span-3">
          <Campo rotulo="Nome *" erro={erros.nome}>
            <Input autoFocus maxLength={120} {...form.register('nome')} />
          </Campo>
        </div>
        <div className="md:col-span-2">
          <Campo rotulo="Classificação" erro={erros.classificacaoId}>
            <Select {...form.register('classificacaoId')}>
              <option value="">—</option>
              {classificacoes.data
                ?.filter((c) => c.ativa || c.id === servico?.classificacaoId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
            </Select>
          </Campo>
        </div>
        <Campo
          rotulo="Forma de preço *"
          dica={porHora ? 'O preço da tabela é o de uma hora' : 'O preço da tabela é o do serviço'}
          erro={erros.formaPreco}
        >
          <Select {...form.register('formaPreco')}>
            {Object.entries(FORMAS_PRECO_SERVICO).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </Select>
        </Campo>
        <Campo
          rotulo={porHora ? 'Horas de trabalho *' : 'Horas de trabalho'}
          dica="Horas e minutos, ex.: 1:30"
          erro={erros.tempoMinutos}
        >
          <InputMascara
            inputMode="numeric"
            placeholder="0:00"
            registro={form.register('tempoMinutos')}
            mascara={mascaraHoras}
          />
        </Campo>
        <div className="md:col-span-4">
          <Campo rotulo="Descrição" erro={erros.descricao}>
            <AreaTexto rows={2} maxLength={500} {...form.register('descricao')} />
          </Campo>
        </div>
        <Campo rotulo="Garantia (dias)" erro={erros.garantiaDias}>
          <Input inputMode="numeric" {...form.register('garantiaDias')} />
        </Campo>
        <Campo rotulo="Garantia (km)" erro={erros.garantiaKm}>
          <Input inputMode="numeric" {...form.register('garantiaKm')} />
        </Campo>
        <div className="md:col-span-4">
          <Campo rotulo="Observação" erro={erros.observacao}>
            <AreaTexto rows={3} maxLength={1000} {...form.register('observacao')} />
          </Campo>
        </div>
      </div>
      <TextoSuave className="text-xs">A garantia fica registrada; as regras de uso serão definidas depois.</TextoSuave>
      <div className="flex gap-2">
        <Botao type="submit" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : servico ? 'Salvar' : 'Cadastrar serviço'}
        </Botao>
        <Botao type="button" variante="secundario" onClick={() => navigate(-1)}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}

export function NovoServico() {
  const pode = usePode();
  const navigate = useNavigate();
  if (!pode('servicos', 'editar')) return <Alerta>Você não tem permissão para cadastrar serviços.</Alerta>;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Titulo>Novo serviço</Titulo>
      <Cartao>
        {/* Depois de cadastrar, o próximo passo natural é informar os preços. */}
        <ServicoForm aoSalvar={(s) => navigate(`/servicos/${s.id}${pode('precos') ? '?aba=precos' : ''}`)} />
      </Cartao>
    </div>
  );
}

export function EditarServico() {
  const { id } = useParams() as { id: string };
  const navigate = useNavigate();
  const permitido = usePode()('servicos', 'editar');
  const servico = useQuery({ queryKey: ['servicos', id], queryFn: () => api<Servico>(`/servicos/${id}`) });
  if (!permitido) return <Alerta>Você não tem permissão para alterar serviços.</Alerta>;
  if (servico.isPending) return <TextoSuave>Carregando…</TextoSuave>;
  if (servico.isError) return <Alerta>{servico.error.message}</Alerta>;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Titulo>
        Editar {formatarCodigoServico(servico.data.codigo)} — {servico.data.nome}
      </Titulo>
      <Cartao>
        <ServicoForm servico={servico.data} aoSalvar={() => navigate(`/servicos/${id}`)} />
      </Cartao>
    </div>
  );
}
