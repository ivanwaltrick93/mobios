import { zodResolver } from '@hookform/resolvers/zod';
import {
  COMBUSTIVEIS,
  formatarDataIso,
  mascaraAno,
  mascaraChassi,
  mascaraKm,
  mascaraPlaca,
  mascaraRenavam,
  normalizarPlaca,
  STATUS_VEICULO,
  veiculoAtualizarSchema,
  type Veiculo,
} from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useId } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import { Etapas } from '../components/Etapas';
import { Placa } from '../components/Placa';
import { Alerta, Botao, Campo, Input, InputMascara, Marcador, Select, TextoSuave } from '../components/ui';
import { api } from '../lib/api';
import { useAssistente, type EtapaDef } from '../lib/assistente';
import { useSugestoesVeiculo } from '../lib/cadastro';
import { aplicarErrosDaApi } from '../lib/formulario';

export type VeiculoEntrada = z.input<typeof veiculoAtualizarSchema>;
export type VeiculoSaida = z.output<typeof veiculoAtualizarSchema>;
export type FormVeiculo = UseFormReturn<VeiculoEntrada, unknown, VeiculoSaida>;

export const valoresVeiculo = (v?: Veiculo): VeiculoEntrada =>
  v
    ? {
        placa: mascaraPlaca(v.placa),
        renavam: v.renavam ?? '',
        chassi: v.chassi ?? '',
        marca: v.marca,
        modelo: v.modelo,
        versao: v.versao ?? '',
        anoFabricacao: v.anoFabricacao ?? '',
        anoModelo: v.anoModelo ?? '',
        cor: v.cor ?? '',
        combustivel: v.combustivel ?? '',
        kmAtual: v.kmAtual == null ? '' : mascaraKm(String(v.kmAtual)),
        principal: v.principal,
        status: v.status,
      }
    : { placa: '', chassi: '', renavam: '', marca: '', modelo: '', versao: '', anoFabricacao: '', anoModelo: '', cor: '', combustivel: '', kmAtual: '', principal: false, status: 'ativo' };

export const useFormVeiculo = (v?: Veiculo) => useForm<VeiculoEntrada, unknown, VeiculoSaida>({ resolver: zodResolver(veiculoAtualizarSchema), defaultValues: valoresVeiculo(v), mode: 'onTouched' });

const ETAPAS: EtapaDef[] = [
  { titulo: 'Identificação', campos: ['placa', 'chassi', 'renavam'] },
  { titulo: 'Modelo', campos: ['marca', 'modelo', 'versao', 'anoFabricacao', 'anoModelo', 'cor', 'combustivel'] },
  { titulo: 'Situação', campos: ['kmAtual', 'status', 'principal'] },
];

/** Campos de cada etapa do veículo. Também usados, todos juntos, na última etapa do cadastro de cliente. */
export function CamposVeiculo({ form, etapa, veiculo }: { form: FormVeiculo; etapa: 0 | 1 | 2; veiculo?: Veiculo }) {
  const erros = form.formState.errors;
  const sugestoes = useSugestoesVeiculo(form.watch('marca') ?? '');
  const listaMarcas = useId();
  const listaModelos = useId();
  const placa = normalizarPlaca(form.watch('placa') ?? '');

  if (etapa === 0) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2 flex flex-wrap items-end gap-4">
          <div className="w-48">
            <Campo rotulo="Placa *" erro={erros.placa}>
              <InputMascara autoFocus placeholder="ABC1D23" registro={form.register('placa')} mascara={mascaraPlaca} />
            </Campo>
          </div>
          {placa.length === 7 && <Placa placa={placa} tamanho="lg" />}
        </div>
        <Campo rotulo="Chassi / VIN" dica="Opcional · 17 caracteres" erro={erros.chassi}>
          <InputMascara registro={form.register('chassi')} mascara={mascaraChassi} />
        </Campo>
        <Campo rotulo="Renavam" dica="Opcional" erro={erros.renavam}>
          <InputMascara inputMode="numeric" placeholder="11 dígitos" registro={form.register('renavam')} mascara={mascaraRenavam} />
        </Campo>
      </div>
    );
  }

  if (etapa === 1) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        <Campo rotulo="Marca *" erro={erros.marca}>
          <Input list={listaMarcas} autoComplete="off" placeholder="Volkswagen, Toyota…" {...form.register('marca')} />
          <datalist id={listaMarcas}>
            {sugestoes.data?.marcas.map((m) => <option key={m} value={m} />)}
          </datalist>
        </Campo>
        <Campo rotulo="Modelo *" erro={erros.modelo}>
          <Input list={listaModelos} autoComplete="off" placeholder="Corolla, T-Cross…" {...form.register('modelo')} />
          <datalist id={listaModelos}>
            {sugestoes.data?.modelos.map((m) => <option key={m} value={m} />)}
          </datalist>
        </Campo>
        <Campo rotulo="Versão" erro={erros.versao}>
          <Input placeholder="XEi, Highline…" {...form.register('versao')} />
        </Campo>
        <Campo rotulo="Ano de fabricação *" erro={erros.anoFabricacao}>
          <InputMascara inputMode="numeric" placeholder="2020" registro={form.register('anoFabricacao')} mascara={mascaraAno} />
        </Campo>
        <Campo rotulo="Ano modelo *" erro={erros.anoModelo}>
          <InputMascara inputMode="numeric" placeholder="2021" registro={form.register('anoModelo')} mascara={mascaraAno} />
        </Campo>
        <Campo rotulo="Cor" erro={erros.cor}>
          <Input {...form.register('cor')} />
        </Campo>
        <Campo rotulo="Combustível" erro={erros.combustivel}>
          <Select {...form.register('combustivel')}>
            <option value="">—</option>
            {Object.entries(COMBUSTIVEIS).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </Select>
        </Campo>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Campo rotulo="Quilometragem atual" dica="Opcional aqui; obrigatória na O.S." erro={erros.kmAtual}>
        <InputMascara inputMode="numeric" placeholder="0" registro={form.register('kmAtual')} mascara={mascaraKm} />
      </Campo>
      <Campo rotulo="Status *" dica="Vendido/Inativo não recebe O.S. nova" erro={erros.status}>
        <Select {...form.register('status')}>
          {Object.entries(STATUS_VEICULO).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </Select>
      </Campo>
      <div className="flex items-center md:pt-6">
        <Marcador rotulo="Veículo principal do cliente" {...form.register('principal')} />
      </div>
      {veiculo && (
        <div className="md:col-span-3">
          <TextoSuave>Última visita: {veiculo.ultimaVisita ? formatarDataIso(veiculo.ultimaVisita) : 'será registrada automaticamente pela O.S.'}</TextoSuave>
        </div>
      )}
    </div>
  );
}

/** Cadastro (em etapas) e edição de veículo de um cliente. */
export function VeiculoForm({ clienteId, veiculo, aoSalvar, aoCancelar }: { clienteId: string; veiculo?: Veiculo; aoSalvar: (v: Veiculo) => void; aoCancelar: () => void }) {
  const queryClient = useQueryClient();
  const form = useFormVeiculo(veiculo);
  const livre = !!veiculo;
  const assistente = useAssistente(form, ETAPAS);
  const salvar = useMutation({
    mutationFn: (dados: VeiculoSaida) =>
      api<Veiculo>(veiculo ? `/veiculos/${veiculo.id}` : '/veiculos', { method: veiculo ? 'PUT' : 'POST', body: veiculo ? dados : { ...dados, clienteId } }),
    onSuccess: (salvo) => {
      queryClient.invalidateQueries({ queryKey: ['veiculos'] });
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      queryClient.invalidateQueries({ queryKey: ['painel'] });
      aoSalvar(salvo);
    },
  });
  const enviar = form.handleSubmit((d) => salvar.mutate(d), assistente.aoInvalido);

  return (
    <form className="space-y-6" noValidate onSubmit={(e) => assistente.interceptarEnvio(e, livre) || enviar(e)}>
      <Etapas titulos={ETAPAS.map((e) => e.titulo)} atual={assistente.etapa} aoIr={assistente.irPara} livre={livre} comErro={assistente.comErro} />
      <Alerta>{salvar.isError && aplicarErrosDaApi(salvar.error, form.setError)}</Alerta>
      <CamposVeiculo form={form} etapa={assistente.etapa as 0 | 1 | 2} veiculo={veiculo} />
      <NavegacaoEtapas assistente={assistente} livre={livre} salvando={salvar.isPending} rotuloSalvar={veiculo ? 'Salvar alterações' : 'Cadastrar veículo'} aoCancelar={aoCancelar} />
    </form>
  );
}

/** Botões do rodapé: Cancelar · Voltar · Continuar/Salvar (na edição, Salvar sempre visível). */
export function NavegacaoEtapas({
  assistente,
  livre,
  salvando,
  rotuloSalvar,
  aoCancelar,
}: {
  assistente: ReturnType<typeof useAssistente>;
  livre: boolean;
  salvando: boolean;
  rotuloSalvar: string;
  aoCancelar: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-borda pt-5">
      <Botao type="button" variante="secundario" onClick={aoCancelar}>
        Cancelar
      </Botao>
      <div className="flex flex-wrap gap-2">
        {assistente.etapa > 0 && (
          <Botao type="button" variante="secundario" onClick={assistente.voltar}>
            <ArrowLeft className="mr-1 size-4" aria-hidden /> Voltar
          </Botao>
        )}
        {!assistente.ultima && (
          <Botao type="button" variante={livre ? 'secundario' : 'primario'} onClick={assistente.avancar}>
            Continuar <ArrowRight className="ml-1 size-4" aria-hidden />
          </Botao>
        )}
        {(livre || assistente.ultima) && (
          <Botao type="submit" disabled={salvando}>
            {salvando ? 'Salvando…' : rotuloSalvar}
          </Botao>
        )}
      </div>
    </div>
  );
}
