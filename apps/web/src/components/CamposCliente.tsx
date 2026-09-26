import {
  type clienteInputSchema,
  FINALIDADES_PJ,
  mascaraCep,
  mascaraEmail,
  mascaraTelefone,
  PAIS_PADRAO,
  TIPOS_ENDERECO,
  UFS,
  type EnderecoInput,
  type ListaOpcoes,
  type ResponsavelInput,
} from '@mobios/shared';
import { useEffect, useState } from 'react';
import { useFieldArray, type UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import { buscarCep, useOpcoes } from '../lib/cadastro';
import { BotaoLink, Campo, Input, InputMascara, Marcador, Secao, Select, TextoSuave } from './ui';

// Campos do cadastro de cliente em lista: endereços e responsáveis (PJ), e o seletor das listas da oficina.

export type EntradaCliente = z.input<typeof clienteInputSchema>;
export type SaidaCliente = z.output<typeof clienteInputSchema>;
export type FormCliente = UseFormReturn<EntradaCliente, unknown, SaidaCliente>;

export const enderecoVazio = (principal: boolean): EnderecoInput => ({
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

const responsavelVazio = (principal: boolean): ResponsavelInput => ({
  nome: '',
  telefone: '',
  telefoneWhatsapp: false,
  email: '',
  cargoId: '',
  principal,
});

/** Pessoas que respondem pela empresa (PJ): ao menos uma, uma principal. */
export function Responsaveis({ form, atuais }: { form: FormCliente; atuais: string[] }) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'responsaveis' });
  const cargos = useOpcoes('cargos');
  const erroLista = form.formState.errors.responsaveis;
  const mensagemLista = erroLista?.message ?? erroLista?.root?.message;

  // Empresa sem responsável: já abre um em branco para preencher. Só ao montar, para não recriar
  // a linha quando o usuário remove o último responsável de propósito.
  useEffect(() => {
    if (fields.length === 0) append(responsavelVazio(true), { shouldFocus: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function marcarPrincipal(indice: number) {
    fields.forEach((_, i) => form.setValue(`responsaveis.${i}.principal`, i === indice, { shouldDirty: true }));
  }
  function remover(indice: number) {
    const eraPrincipal = form.getValues(`responsaveis.${indice}.principal`);
    remove(indice);
    if (eraPrincipal) form.setValue('responsaveis.0.principal', true);
  }
  // Funções ativas + as que o cliente já usava (mesmo se desativadas depois).
  const opcoes = cargos.data?.filter((o) => o.ativa || atuais.includes(o.id)) ?? [];

  return (
    <Secao
      titulo="Responsáveis pela empresa"
      acao={
        <BotaoLink type="button" onClick={() => append(responsavelVazio(fields.length === 0))}>
          + Adicionar responsável
        </BotaoLink>
      }
    >
      <TextoSuave>
        Quem aprova orçamentos, leva ou busca o veículo. O principal é o primeiro a ser contatado.
      </TextoSuave>
      {mensagemLista && <p className="text-sm text-perigo">{mensagemLista}</p>}
      {fields.map((f, i) => {
        const erros = form.formState.errors.responsaveis?.[i];
        const principal = form.watch(`responsaveis.${i}.principal`);
        return (
          <div key={f.id} className="space-y-4 rounded-md border border-borda bg-superficie-alt p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4">
                <span className="text-sm font-medium">Responsável {i + 1}</span>
                <Marcador
                  rotulo="Principal"
                  checked={!!principal}
                  onChange={(e) => e.target.checked && marcarPrincipal(i)}
                />
              </div>
              {fields.length > 1 && (
                <BotaoLink type="button" perigo onClick={() => remover(i)}>
                  Remover
                </BotaoLink>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Campo rotulo="Nome *" erro={erros?.nome}>
                <Input autoComplete="off" {...form.register(`responsaveis.${i}.nome`)} />
              </Campo>
              <Campo rotulo="Função *" erro={erros?.cargoId}>
                <Select disabled={cargos.isPending} {...form.register(`responsaveis.${i}.cargoId`)}>
                  <option value="">—</option>
                  {opcoes.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nome}
                      {!o.ativa && ' (desativada)'}
                    </option>
                  ))}
                </Select>
              </Campo>
              <div className="space-y-2">
                <Campo rotulo="Telefone *" erro={erros?.telefone}>
                  <InputMascara
                    type="tel"
                    placeholder="(00) 00000-0000"
                    registro={form.register(`responsaveis.${i}.telefone`)}
                    mascara={mascaraTelefone}
                  />
                </Campo>
                <Marcador rotulo="Este número é WhatsApp" {...form.register(`responsaveis.${i}.telefoneWhatsapp`)} />
              </div>
              <Campo rotulo="E-mail" erro={erros?.email}>
                <InputMascara
                  type="email"
                  inputMode="email"
                  placeholder="nome@empresa.com"
                  registro={form.register(`responsaveis.${i}.email`)}
                  mascara={mascaraEmail}
                />
              </Campo>
            </div>
          </div>
        );
      })}
    </Secao>
  );
}

/** Lista da oficina: mostra os itens ativos e mantém o atual do cliente, mesmo se desativado depois. */
export function SeletorOpcao({
  form,
  lista,
  campo,
  rotulo,
  atual,
  erro,
}: {
  form: FormCliente;
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

export function Enderecos({ form, pf }: { form: FormCliente; pf: boolean }) {
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
        <EnderecoCampos
          key={f.id}
          form={form}
          indice={i}
          pf={pf}
          podeRemover={fields.length > 1}
          aoMarcarPrincipal={() => marcarPrincipal(i)}
          aoRemover={() => remover(i)}
        />
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
  form: FormCliente;
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
          <Marcador
            rotulo="Endereço principal"
            checked={!!principal}
            onChange={(e) => e.target.checked && aoMarcarPrincipal()}
          />
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
            erro={
              erros?.cep ??
              (cep === 'nao-encontrado'
                ? { message: 'CEP não encontrado: preencha o endereço manualmente' }
                : undefined)
            }
            dica={
              cep === 'buscando' ? 'Buscando endereço…' : noBrasil ? 'Preenche o endereço automaticamente' : undefined
            }
          >
            <InputMascara
              inputMode={noBrasil ? 'numeric' : undefined}
              placeholder={noBrasil ? '00000-000' : undefined}
              registro={{
                ...cepRegistrado,
                onBlur: async (e) => {
                  await cepRegistrado.onBlur(e);
                  preencherPeloCep(e.target.value);
                },
              }}
              mascara={noBrasil ? mascaraCep : (v) => v}
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
          <Campo rotulo={noBrasil ? 'Estado *' : 'Estado / província *'} erro={erros?.uf}>
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
