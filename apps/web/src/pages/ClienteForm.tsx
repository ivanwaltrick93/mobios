import { zodResolver } from '@hookform/resolvers/zod';
import {
  clienteInputSchema,
  hojeIso,
  mascaraCep,
  mascaraDocumento,
  mascaraEmail,
  mascaraTelefone,
  PAIS_PADRAO,
  SEXOS,
  veiculoAtualizarSchema,
  type Cliente,
  type Veiculo,
} from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, CarFront, User } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import {
  enderecoVazio,
  Enderecos,
  Responsaveis,
  SeletorOpcao,
  type EntradaCliente as Entrada,
  type FormCliente as Form,
  type SaidaCliente as Saida,
} from '../components/CamposCliente';
import { Etapas } from '../components/Etapas';
import {
  Alerta,
  AreaTexto,
  BotaoLink,
  Campo,
  Input,
  InputMascara,
  Marcador,
  Secao,
  Select,
  TextoSuave,
} from '../components/ui';
import { api } from '../lib/api';
import { useAssistente, type EtapaDef } from '../lib/assistente';
import { aplicarErrosDaApi } from '../lib/formulario';
import { CamposVeiculo, NavegacaoEtapas, useFormVeiculo } from './VeiculoForm';

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
      responsaveis: [],
    };
  }
  return {
    tipo: c.tipo,
    nome: c.nome,
    // Valores gravados sem pontuação voltam com a máscara da tela.
    cpfCnpj: mascaraDocumento(c.cpfCnpj ?? '', c.tipo),
    rgIe: c.rgIe ?? '',
    dataNascimento: c.dataNascimento ?? '',
    sexo: c.sexo ?? '',
    telefone: mascaraTelefone(c.telefone ?? ''),
    whatsapp: mascaraTelefone(c.whatsapp ?? ''),
    email: c.email ?? '',
    observacoes: c.observacoes ?? '',
    clienteDesde: c.clienteDesde,
    origemId: c.origemId ?? '',
    relacionamentoId: c.relacionamentoId ?? '',
    ativo: c.ativo,
    // Cadastro antigo sem endereço: já abre um em branco para completar.
    enderecos: c.enderecos.length
      ? c.enderecos.map(({ id: _id, ...e }) => ({
          ...e,
          cep: e.pais === PAIS_PADRAO ? mascaraCep(e.cep) : e.cep,
          complemento: e.complemento ?? '',
        }))
      : [enderecoVazio(true)],
    responsaveis: c.responsaveis.map(({ id: _id, cargoNome: _cargo, ...r }) => ({
      ...r,
      telefone: mascaraTelefone(r.telefone),
      email: r.email ?? '',
    })),
  };
}

const ETAPA = {
  dados: { titulo: 'Dados', campos: ['tipo', 'cpfCnpj', 'nome', 'rgIe', 'dataNascimento', 'sexo'] },
  contato: {
    titulo: 'Contato',
    campos: ['telefone', 'whatsapp', 'email', 'clienteDesde', 'origemId', 'relacionamentoId', 'ativo', 'observacoes'],
  },
  responsaveis: { titulo: 'Responsáveis', campos: ['responsaveis'] },
  endereco: { titulo: 'Endereço', campos: ['enderecos'] },
  veiculo: { titulo: 'Veículo', campos: [] },
} satisfies Record<string, EtapaDef>;
export type EtapaCliente = keyof typeof ETAPA;

/** PJ tem a etapa Responsáveis; o cadastro novo termina com o veículo (opcional). */
const etapasDo = (tipo: 'PF' | 'PJ', novo: boolean): EtapaCliente[] => [
  'dados',
  'contato',
  ...(tipo === 'PJ' ? (['responsaveis'] as const) : []),
  'endereco',
  ...(novo ? (['veiculo'] as const) : []),
];

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
export function ClienteForm({
  cliente,
  etapaInicial,
  aoSalvar,
  aoCancelar,
}: {
  cliente?: Cliente;
  etapaInicial?: EtapaCliente;
  aoSalvar: (c: Cliente) => void;
  aoCancelar: () => void;
}) {
  const queryClient = useQueryClient();
  const livre = !!cliente;
  const form = useForm<Entrada, unknown, Saida>({
    resolver: zodResolver(clienteInputSchema),
    defaultValues: valoresIniciais(cliente),
    mode: 'onTouched',
  });
  const tipo = form.watch('tipo') === 'PJ' ? 'PJ' : 'PF';
  const ids = etapasDo(tipo, !livre);
  const etapas = ids.map((id) => ETAPA[id]);
  const assistente = useAssistente(form, etapas, etapaInicial ? Math.max(0, ids.indexOf(etapaInicial)) : 0);
  const formVeiculo = useFormVeiculo();
  const [comVeiculo, setComVeiculo] = useState<boolean | null>(null);
  const [salvo, setSalvo] = useState<Cliente | null>(null);

  const salvar = useMutation({
    mutationFn: async ({
      dados,
      veiculo,
    }: {
      dados: Saida;
      veiculo: z.output<typeof veiculoAtualizarSchema> | null;
    }) => {
      // Se só o veículo falhou antes, o cliente já existe: não grava de novo.
      const c =
        salvo ??
        (await api<Cliente>(cliente ? `/clientes/${cliente.id}` : '/clientes', {
          method: cliente ? 'PUT' : 'POST',
          body: dados,
        }));
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
  const etapaAtual = ids[assistente.etapa]!;

  return (
    <form className="space-y-6" noValidate onSubmit={(e) => assistente.interceptarEnvio(e, livre) || enviar(e)}>
      <Etapas
        titulos={etapas.map((e) => e.titulo)}
        atual={assistente.etapa}
        aoIr={assistente.irPara}
        livre={livre}
        comErro={assistente.comErro}
      />

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

      {etapaAtual === 'dados' && <EtapaDados form={form} />}
      {etapaAtual === 'contato' && <EtapaContato form={form} cliente={cliente} />}
      {etapaAtual === 'responsaveis' && (
        <Responsaveis form={form} atuais={cliente?.responsaveis.map((r) => r.cargoId) ?? []} />
      )}
      {etapaAtual === 'endereco' && <Enderecos form={form} pf={tipo === 'PF'} />}
      {etapaAtual === 'veiculo' && (
        <div className="space-y-6">
          <div>
            <h3 className="font-medium">O cliente já trouxe um veículo?</h3>
            <TextoSuave>Você pode cadastrar agora ou depois, pelo perfil do cliente.</TextoSuave>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <OpcaoGrande
              icone={<CarFront />}
              titulo="Sim, cadastrar o veículo"
              descricao="Placa, modelo e ano"
              ativa={comVeiculo === true}
              aoEscolher={() => setComVeiculo(true)}
            />
            <OpcaoGrande
              icone={<User />}
              titulo="Agora não"
              descricao="Só o cadastro do cliente"
              ativa={comVeiculo === false}
              aoEscolher={() => setComVeiculo(false)}
            />
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
      {!livre && assistente.ultima && comVeiculo === null && (
        <TextoSuave className="text-right text-xs">Escolha uma opção acima ou apenas cadastre o cliente.</TextoSuave>
      )}
    </form>
  );
}

/** Botão grande de escolha (tipo de cliente, cadastrar veículo agora). */
function OpcaoGrande({
  icone,
  titulo,
  descricao,
  ativa,
  aoEscolher,
}: {
  icone: ReactNode;
  titulo: string;
  descricao: string;
  ativa: boolean;
  aoEscolher: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativa}
      onClick={aoEscolher}
      className={`flex items-center gap-4 rounded-lg border-2 p-4 text-left transition ${
        ativa ? 'border-primaria bg-primaria-suave' : 'border-borda bg-superficie hover:border-borda-forte'
      }`}
    >
      <span
        className={`flex size-11 shrink-0 items-center justify-center rounded-full [&>svg]:size-5 ${ativa ? 'bg-primaria text-sobre-primaria' : 'bg-superficie-alt text-texto-suave'}`}
      >
        {icone}
      </span>
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
  function escolherTipo(tipo: 'PF' | 'PJ') {
    form.setValue('tipo', tipo, { shouldDirty: true });
    // Refaz a máscara do documento; PF não tem responsáveis.
    form.setValue('cpfCnpj', mascaraDocumento(form.getValues('cpfCnpj') ?? '', tipo));
    if (tipo === 'PF') form.setValue('responsaveis', []);
    form.clearErrors('cpfCnpj');
  }
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <OpcaoGrande
          icone={<User />}
          titulo="Pessoa física"
          descricao="Cliente com CPF"
          ativa={pf}
          aoEscolher={() => escolherTipo('PF')}
        />
        <OpcaoGrande
          icone={<Building2 />}
          titulo="Pessoa jurídica"
          descricao="Empresa com CNPJ"
          ativa={!pf}
          aoEscolher={() => escolherTipo('PJ')}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Campo
          rotulo={pf ? 'CPF *' : 'CNPJ *'}
          dica={pf ? undefined : 'Aceita o novo CNPJ com letras'}
          erro={erros.cpfCnpj}
        >
          {/* CNPJ alfanumérico (Receita, jul/2026): teclado de texto e letras em maiúsculas. */}
          <InputMascara
            autoFocus
            inputMode={pf ? 'numeric' : 'text'}
            placeholder={pf ? '000.000.000-00' : '00.000.000/0000-00'}
            registro={form.register('cpfCnpj')}
            mascara={(v) => mascaraDocumento(v, pf ? 'PF' : 'PJ')}
          />
        </Campo>
        <div className="md:col-span-2">
          <Campo rotulo={pf ? 'Nome completo *' : 'Razão social *'} erro={erros.nome}>
            <Input {...form.register('nome')} />
          </Campo>
        </div>
        <Campo rotulo={pf ? 'RG' : 'Inscrição estadual'} dica={pf ? undefined : 'Ou "ISENTO"'} erro={erros.rgIe}>
          <Input className={pf ? '' : 'uppercase'} maxLength={20} {...form.register('rgIe')} />
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
            <InputMascara
              autoFocus
              type="tel"
              placeholder="(00) 00000-0000"
              registro={form.register('telefone')}
              mascara={mascaraTelefone}
            />
          </Campo>
          <div className="space-y-2">
            <Campo rotulo="WhatsApp *" erro={erros.whatsapp}>
              <InputMascara
                type="tel"
                placeholder="(00) 00000-0000"
                readOnly={mesmoNumero}
                registro={form.register('whatsapp')}
                mascara={mascaraTelefone}
              />
            </Campo>
            <Marcador
              rotulo="Mesmo número do telefone"
              checked={mesmoNumero}
              onChange={(e) => setMesmoNumero(e.target.checked)}
            />
          </div>
          <Campo rotulo="E-mail" dica="Orçamentos, nota fiscal e comunicação" erro={erros.email}>
            <InputMascara
              type="email"
              inputMode="email"
              placeholder="nome@exemplo.com"
              registro={form.register('email')}
              mascara={mascaraEmail}
            />
          </Campo>
        </div>
      </Secao>
      <Secao titulo="Relacionamento">
        <div className="grid gap-4 md:grid-cols-4">
          <Campo rotulo="Cliente desde *" erro={erros.clienteDesde}>
            <Input type="date" max={hojeIso()} {...form.register('clienteDesde')} />
          </Campo>
          <SeletorOpcao
            form={form}
            lista="origens"
            campo="origemId"
            rotulo="Origem do cliente"
            atual={cliente?.origemId}
            erro={erros.origemId}
          />
          <SeletorOpcao
            form={form}
            lista="relacionamentos"
            campo="relacionamentoId"
            rotulo="Tipo de relacionamento"
            atual={cliente?.relacionamentoId}
            erro={erros.relacionamentoId}
          />
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
