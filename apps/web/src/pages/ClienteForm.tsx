import { zodResolver } from '@hookform/resolvers/zod';
import {
  clienteInputSchema,
  FINALIDADES_PJ,
  hojeIso,
  PAIS_PADRAO,
  SEXOS,
  TIPOS_ENDERECO,
  UFS,
  veiculoAtualizarSchema,
  type Cliente,
  type EnderecoInput,
  type ListaOpcoes,
  type Veiculo,
} from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, CarFront, User } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useFieldArray, useForm, type UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import { Etapas } from '../components/Etapas';
import { Alerta, AreaTexto, Botao, BotaoLink, Campo, Input, Marcador, Secao, Select, TextoSuave } from '../components/ui';
import { api } from '../lib/api';
import { useAssistente, type EtapaDef } from '../lib/assistente';
import { buscarCep, useOpcoes } from '../lib/cadastro';
import { aplicarErrosDaApi } from '../lib/formulario';
import { CamposVeiculo, NavegacaoEtapas, useFormVeiculo } from './VeiculoForm';

type Entrada = z.input<typeof clienteInputSchema>;
type Saida = z.output<typeof clienteInputSchema>;
type Form = UseFormReturn<Entrada, unknown, Saida>;

const enderecoVazio = (principal: boolean): EnderecoInput => ({
  tipo: 'residencial',
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
  pais: PAIS_PADRAO,
  principal,
  faturamento: false,
  entrega: false,
  cobranca: false,
});

/** Valores iniciais: nulls viram '' para os campos controlados pelo formulário. */
function valoresIniciais(c?: Cliente): Entrada {
  if (!c) {
    return {
      tipo: 'PF',
      nome: '',
      cpfCnpj: '',
      rgIe: '',
      dataNascimento: '',
      telefone: '',
      whatsapp: '',
      email: '',
      observacoes: '',
      clienteDesde: hojeIso(),
      sexo: '',
      origemId: '',
      relacionamentoId: '',
      ativo: true,
      enderecos: [enderecoVazio(true)],
    };
  }
  return {
    tipo: c.tipo,
    nome: c.nome,
    cpfCnpj: c.cpfCnpj ?? '',
    rgIe: c.rgIe ?? '',
    dataNascimento: c.dataNascimento ?? '',
    sexo: c.sexo ?? '',
    telefone: c.telefone ?? '',
    whatsapp: c.whatsapp ?? '',
    email: c.email ?? '',
    observacoes: c.observacoes ?? '',
    clienteDesde: c.clienteDesde,
    origemId: c.origemId ?? '',
    relacionamentoId: c.relacionamentoId ?? '',
    ativo: c.ativo,
    // Cadastro antigo sem endereço: já abre um em branco para completar.
    enderecos: c.enderecos.length ? c.enderecos.map(({ id: _id, ...e }) => ({ ...e, complemento: e.complemento ?? '' })) : [enderecoVazio(true)],
  };
}

const ETAPAS_CLIENTE: EtapaDef[] = [
  { titulo: 'Dados', campos: ['tipo', 'cpfCnpj', 'nome', 'rgIe', 'dataNascimento', 'sexo'] },
  { titulo: 'Contato', campos: ['telefone', 'whatsapp', 'email', 'clienteDesde', 'origemId', 'relacionamentoId', 'ativo', 'observacoes'] },
  { titulo: 'Endereço', campos: ['enderecos'] },
];
const ETAPA_VEICULO: EtapaDef = { titulo: 'Veículo', campos: [] };

/** Falha só no veículo, depois de o cliente já ter sido gravado. */
class FalhaVeiculo extends Error {
  constructor(public erro: unknown) {
    super(erro instanceof Error ? erro.message : 'Não foi possível salvar o veículo');
  }
}

/**
 * Cadastro de cliente em etapas (Dados → Contato → Endereço → Veículo opcional).
 * Na edição (`cliente`), as etapas ficam livres, não há etapa de veículo e o salvar fica sempre visível.
 */
export function ClienteForm({ cliente, etapaInicial = 0, aoSalvar, aoCancelar }: { cliente?: Cliente; etapaInicial?: number; aoSalvar: (c: Cliente) => void; aoCancelar: () => void }) {
  const queryClient = useQueryClient();
  const livre = !!cliente;
  const etapas = livre ? ETAPAS_CLIENTE : [...ETAPAS_CLIENTE, ETAPA_VEICULO];
  const form = useForm<Entrada, unknown, Saida>({ resolver: zodResolver(clienteInputSchema), defaultValues: valoresIniciais(cliente), mode: 'onTouched' });
  const assistente = useAssistente(form, etapas, etapaInicial);
  const formVeiculo = useFormVeiculo();
  const [comVeiculo, setComVeiculo] = useState<boolean | null>(null);
  const [salvo, setSalvo] = useState<Cliente | null>(null);

  const salvar = useMutation({
    mutationFn: async ({ dados, veiculo }: { dados: Saida; veiculo: z.output<typeof veiculoAtualizarSchema> | null }) => {
      // Se só o veículo falhou antes, o cliente já existe: não grava de novo.
      const c = salvo ?? (await api<Cliente>(cliente ? `/clientes/${cliente.id}` : '/clientes', { method: cliente ? 'PUT' : 'POST', body: dados }));
      setSalvo(cliente ? null : c);
      if (veiculo) {
        try {
          await api<Veiculo>('/veiculos', { method: 'POST', body: { ...veiculo, clienteId: c.id } });
        } catch (e) {
          throw new FalhaVeiculo(e);
        }
      }
      return c;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      queryClient.invalidateQueries({ queryKey: ['veiculos'] });
      queryClient.invalidateQueries({ queryKey: ['opcoes'] }); // contagem de uso das listas
      queryClient.invalidateQueries({ queryKey: ['painel'] });
    },
    onSuccess: aoSalvar,
  });

  const enviar = form.handleSubmit(async (dados) => {
    let veiculo = null;
    if (!livre && comVeiculo) {
      if (!(await formVeiculo.trigger())) return;
      veiculo = veiculoAtualizarSchema.parse(formVeiculo.getValues());
    }
    salvar.mutate({ dados, veiculo });
  }, assistente.aoInvalido);

  const erroSalvar = salvar.error;
  const etapaAtual = etapas[assistente.etapa]!;

  return (
    <form className="space-y-6" noValidate onSubmit={(e) => assistente.interceptarEnvio(e, livre) || enviar(e)}>
      <Etapas titulos={etapas.map((e) => e.titulo)} atual={assistente.etapa} aoIr={assistente.irPara} livre={livre} comErro={assistente.comErro} />

      {erroSalvar instanceof FalhaVeiculo ? (
        <Alerta>
          O cliente foi cadastrado, mas o veículo não: {aplicarErrosDaApi(erroSalvar.erro, formVeiculo.setError)}{' '}
          {salvo && (
            <BotaoLink type="button" onClick={() => aoSalvar(salvo)}>
              Ir para o cliente sem o veículo
            </BotaoLink>
          )}
        </Alerta>
      ) : (
        <Alerta>{erroSalvar && aplicarErrosDaApi(erroSalvar, form.setError)}</Alerta>
      )}

      {etapaAtual === ETAPAS_CLIENTE[0] && <EtapaDados form={form} />}
      {etapaAtual === ETAPAS_CLIENTE[1] && <EtapaContato form={form} cliente={cliente} />}
      {etapaAtual === ETAPAS_CLIENTE[2] && <Enderecos form={form} pf={form.watch('tipo') !== 'PJ'} />}
      {etapaAtual === ETAPA_VEICULO && (
        <div className="space-y-6">
          <div>
            <h3 className="font-medium">O cliente já trouxe um veículo?</h3>
            <TextoSuave>Você pode cadastrar agora ou depois, pelo perfil do cliente.</TextoSuave>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <OpcaoGrande icone={<CarFront />} titulo="Sim, cadastrar o veículo" descricao="Placa, modelo e ano" ativa={comVeiculo === true} aoEscolher={() => setComVeiculo(true)} />
            <OpcaoGrande icone={<User />} titulo="Agora não" descricao="Só o cadastro do cliente" ativa={comVeiculo === false} aoEscolher={() => setComVeiculo(false)} />
          </div>
          {comVeiculo && (
            <div className="space-y-6 rounded-lg border border-borda bg-superficie-alt p-4">
              {([0, 1, 2] as const).map((i) => (
                <CamposVeiculo key={i} form={formVeiculo} etapa={i} />
              ))}
            </div>
          )}
        </div>
      )}

      <NavegacaoEtapas
        assistente={assistente}
        livre={livre}
        salvando={salvar.isPending}
        rotuloSalvar={livre ? 'Salvar alterações' : comVeiculo ? 'Cadastrar cliente e veículo' : 'Cadastrar cliente'}
        aoCancelar={aoCancelar}
      />
      {!livre && assistente.ultima && comVeiculo === null && <TextoSuave className="text-right text-xs">Escolha uma opção acima ou apenas cadastre o cliente.</TextoSuave>}
    </form>
  );
}

/** Botão grande de escolha (tipo de cliente, cadastrar veículo agora). */
function OpcaoGrande({ icone, titulo, descricao, ativa, aoEscolher }: { icone: ReactNode; titulo: string; descricao: string; ativa: boolean; aoEscolher: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={ativa}
      onClick={aoEscolher}
      className={`flex items-center gap-4 rounded-lg border-2 p-4 text-left transition ${
        ativa ? 'border-primaria bg-primaria-suave' : 'border-borda bg-superficie hover:border-borda-forte'
      }`}
    >
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-full [&>svg]:size-5 ${ativa ? 'bg-primaria text-sobre-primaria' : 'bg-superficie-alt text-texto-suave'}`}>{icone}</span>
      <span>
        <span className={`block font-medium ${ativa ? 'text-primaria' : 'text-texto'}`}>{titulo}</span>
        <span className="block text-sm text-texto-suave">{descricao}</span>
      </span>
    </button>
  );
}

function EtapaDados({ form }: { form: Form }) {
  const erros = form.formState.errors;
  const pf = form.watch('tipo') !== 'PJ';
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <OpcaoGrande icone={<User />} titulo="Pessoa física" descricao="Cliente com CPF" ativa={pf} aoEscolher={() => form.setValue('tipo', 'PF', { shouldDirty: true })} />
        <OpcaoGrande icone={<Building2 />} titulo="Pessoa jurídica" descricao="Empresa com CNPJ" ativa={!pf} aoEscolher={() => form.setValue('tipo', 'PJ', { shouldDirty: true })} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Campo rotulo={pf ? 'CPF *' : 'CNPJ *'} erro={erros.cpfCnpj}>
          <Input autoFocus inputMode="numeric" placeholder={pf ? '000.000.000-00' : '00.000.000/0000-00'} {...form.register('cpfCnpj')} />
        </Campo>
        <div className="md:col-span-2">
          <Campo rotulo={pf ? 'Nome completo *' : 'Razão social *'} erro={erros.nome}>
            <Input {...form.register('nome')} />
          </Campo>
        </div>
        <Campo rotulo={pf ? 'RG' : 'Inscrição estadual'} dica={pf ? undefined : 'Ou "ISENTO"'} erro={erros.rgIe}>
          <Input {...form.register('rgIe')} />
        </Campo>
        {pf && (
          <>
            <Campo rotulo="Data de nascimento" erro={erros.dataNascimento}>
              <Input type="date" max={hojeIso()} {...form.register('dataNascimento')} />
            </Campo>
            <Campo rotulo="Sexo" erro={erros.sexo}>
              <Select {...form.register('sexo')}>
                <option value="">—</option>
                {Object.entries(SEXOS).map(([valor, rotulo]) => (
                  <option key={valor} value={valor}>
                    {rotulo}
                  </option>
                ))}
              </Select>
            </Campo>
          </>
        )}
      </div>
    </div>
  );
}

function EtapaContato({ form, cliente }: { form: Form; cliente?: Cliente }) {
  const erros = form.formState.errors;
  // "WhatsApp é o mesmo número": copia o telefone enquanto estiver marcado.
  const [mesmoNumero, setMesmoNumero] = useState(() => {
    const { telefone, whatsapp } = form.getValues();
    return !!whatsapp && whatsapp === telefone;
  });
  const telefone = form.watch('telefone');
  useEffect(() => {
    if (mesmoNumero) form.setValue('whatsapp', telefone ?? '', { shouldValidate: form.formState.isSubmitted });
  }, [mesmoNumero, telefone, form]);

  return (
    <div className="space-y-6">
      <Secao titulo="Contato">
        <div className="grid gap-4 md:grid-cols-3">
          <Campo rotulo="Telefone principal *" erro={erros.telefone}>
            <Input autoFocus type="tel" placeholder="(00) 00000-0000" {...form.register('telefone')} />
          </Campo>
          <div className="space-y-2">
            <Campo rotulo="WhatsApp *" erro={erros.whatsapp}>
              <Input type="tel" placeholder="(00) 00000-0000" readOnly={mesmoNumero} {...form.register('whatsapp')} />
            </Campo>
            <Marcador rotulo="Mesmo número do telefone" checked={mesmoNumero} onChange={(e) => setMesmoNumero(e.target.checked)} />
          </div>
          <Campo rotulo="E-mail" dica="Orçamentos, nota fiscal e comunicação" erro={erros.email}>
            <Input type="email" {...form.register('email')} />
          </Campo>
        </div>
      </Secao>
      <Secao titulo="Relacionamento">
        <div className="grid gap-4 md:grid-cols-4">
          <Campo rotulo="Cliente desde *" erro={erros.clienteDesde}>
            <Input type="date" max={hojeIso()} {...form.register('clienteDesde')} />
          </Campo>
          <SeletorOpcao form={form} lista="origens" campo="origemId" rotulo="Origem do cliente" atual={cliente?.origemId} erro={erros.origemId} />
          <SeletorOpcao form={form} lista="relacionamentos" campo="relacionamentoId" rotulo="Tipo de relacionamento" atual={cliente?.relacionamentoId} erro={erros.relacionamentoId} />
          <Campo rotulo="Status *" dica="Inativo não recebe O.S. nova" erro={erros.ativo}>
            <Select {...form.register('ativo', { setValueAs: (v) => v === true || v === 'true' })}>
              <option value="true">Ativo</option>
              <option value="false">Inativo</option>
            </Select>
          </Campo>
        </div>
        <Campo rotulo="Observações" erro={erros.observacoes}>
          <AreaTexto {...form.register('observacoes')} />
        </Campo>
      </Secao>
    </div>
  );
}

/** Lista da oficina: mostra os itens ativos e mantém o atual do cliente, mesmo se desativado depois. */
function SeletorOpcao({
  form,
  lista,
  campo,
  rotulo,
  atual,
  erro,
}: {
  form: Form;
  lista: ListaOpcoes;
  campo: 'origemId' | 'relacionamentoId';
  rotulo: string;
  atual?: string | null;
  erro?: { message?: string };
}) {
  const opcoes = useOpcoes(lista);
  const visiveis = opcoes.data?.filter((o) => o.ativa || o.id === atual) ?? [];
  return (
    <Campo rotulo={rotulo} erro={erro}>
      <Select {...form.register(campo)} disabled={opcoes.isPending}>
        <option value="">—</option>
        {visiveis.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nome}
            {!o.ativa && ' (desativado)'}
          </option>
        ))}
      </Select>
    </Campo>
  );
}

function Enderecos({ form, pf }: { form: Form; pf: boolean }) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'enderecos' });
  const erroLista = form.formState.errors.enderecos;
  const mensagemLista = erroLista?.message ?? erroLista?.root?.message;

  /** Um só principal: marcar um desmarca os outros. */
  function marcarPrincipal(indice: number) {
    fields.forEach((_, i) => form.setValue(`enderecos.${i}.principal`, i === indice, { shouldDirty: true }));
  }

  function remover(indice: number) {
    const eraPrincipal = form.getValues(`enderecos.${indice}.principal`);
    remove(indice);
    if (eraPrincipal) form.setValue('enderecos.0.principal', true);
  }

  return (
    <Secao
      titulo="Endereços"
      acao={
        <BotaoLink type="button" onClick={() => append(enderecoVazio(fields.length === 0))}>
          + Adicionar endereço
        </BotaoLink>
      }
    >
      {mensagemLista && <p className="text-sm text-perigo">{mensagemLista}</p>}
      {fields.map((f, i) => (
        <EnderecoCampos key={f.id} form={form} indice={i} pf={pf} podeRemover={fields.length > 1} aoMarcarPrincipal={() => marcarPrincipal(i)} aoRemover={() => remover(i)} />
      ))}
    </Secao>
  );
}

function EnderecoCampos({
  form,
  indice,
  pf,
  podeRemover,
  aoMarcarPrincipal,
  aoRemover,
}: {
  form: Form;
  indice: number;
  pf: boolean;
  podeRemover: boolean;
  aoMarcarPrincipal: () => void;
  aoRemover: () => void;
}) {
  const nome = <K extends keyof EnderecoInput>(k: K) => `enderecos.${indice}.${k}` as const;
  const erros = form.formState.errors.enderecos?.[indice];
  const principal = form.watch(nome('principal'));
  const pais = form.watch(nome('pais')) ?? PAIS_PADRAO;
  const noBrasil = pais.trim().toLowerCase() === PAIS_PADRAO.toLowerCase();
  const [cep, setCep] = useState<'buscando' | 'nao-encontrado' | null>(null);

  async function preencherPeloCep(valor: string) {
    if (!noBrasil || valor.replace(/\D/g, '').length !== 8) return;
    setCep('buscando');
    const endereco = await buscarCep(valor);
    setCep(endereco ? null : 'nao-encontrado');
    if (!endereco) return;
    for (const campo of ['logradouro', 'bairro', 'cidade', 'uf'] as const) {
      if (endereco[campo]) form.setValue(nome(campo), endereco[campo], { shouldValidate: form.formState.isSubmitted });
    }
    form.setFocus(nome('numero'));
  }

  const cepRegistrado = form.register(nome('cep'));

  return (
    <div className="space-y-4 rounded-md border border-borda bg-superficie-alt p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-sm font-medium">Endereço {indice + 1}</span>
          <Marcador rotulo="Endereço principal" checked={!!principal} onChange={(e) => e.target.checked && aoMarcarPrincipal()} />
        </div>
        {podeRemover && (
          <BotaoLink type="button" perigo onClick={aoRemover}>
            Remover
          </BotaoLink>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-6">
        <div className="md:col-span-2">
          <Campo rotulo="Tipo de endereço *" erro={erros?.tipo}>
            <Select {...form.register(nome('tipo'))}>
              {Object.entries(TIPOS_ENDERECO).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </Select>
          </Campo>
        </div>
        <div className="md:col-span-2">
          <Campo
            rotulo="CEP *"
            erro={erros?.cep ?? (cep === 'nao-encontrado' ? { message: 'CEP não encontrado: preencha o endereço manualmente' } : undefined)}
            dica={cep === 'buscando' ? 'Buscando endereço…' : noBrasil ? 'Preenche o endereço automaticamente' : undefined}
          >
            <Input
              inputMode={noBrasil ? 'numeric' : undefined}
              placeholder={noBrasil ? '00000-000' : undefined}
              {...cepRegistrado}
              onBlur={(e) => {
                cepRegistrado.onBlur(e);
                preencherPeloCep(e.target.value);
              }}
            />
          </Campo>
        </div>
        <div className="md:col-span-2">
          <Campo rotulo="País *" erro={erros?.pais}>
            <Input {...form.register(nome('pais'))} />
          </Campo>
        </div>
        <div className="md:col-span-4">
          <Campo rotulo="Logradouro *" erro={erros?.logradouro}>
            <Input {...form.register(nome('logradouro'))} />
          </Campo>
        </div>
        <div className="md:col-span-2">
          <Campo rotulo="Número *" dica="Sem número: S/N" erro={erros?.numero}>
            <Input {...form.register(nome('numero'))} />
          </Campo>
        </div>
        <div className="md:col-span-3">
          <Campo rotulo="Complemento" erro={erros?.complemento}>
            <Input {...form.register(nome('complemento'))} />
          </Campo>
        </div>
        <div className="md:col-span-3">
          <Campo rotulo="Bairro *" erro={erros?.bairro}>
            <Input {...form.register(nome('bairro'))} />
          </Campo>
        </div>
        <div className="md:col-span-4">
          <Campo rotulo="Cidade *" erro={erros?.cidade}>
            <Input {...form.register(nome('cidade'))} />
          </Campo>
        </div>
        <div className="md:col-span-2">
          <Campo rotulo="Estado *" erro={erros?.uf}>
            {noBrasil ? (
              <Select {...form.register(nome('uf'))}>
                <option value="">—</option>
                {UFS.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </Select>
            ) : (
              <Input {...form.register(nome('uf'))} />
            )}
          </Campo>
        </div>
      </div>

      {!pf && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-sm font-medium">Usar também para:</span>
          {Object.entries(FINALIDADES_PJ).map(([campo, rotulo]) => (
            <Marcador key={campo} rotulo={rotulo} {...form.register(nome(campo as keyof typeof FINALIDADES_PJ))} />
          ))}
        </div>
      )}
    </div>
  );
}
