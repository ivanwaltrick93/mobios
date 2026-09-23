import { zodResolver } from '@hookform/resolvers/zod';
import { mascaraCest, mascaraCodigo, mascaraGtin, mascaraNcm, materialInputSchema, ORIGENS_FISCAIS, UNIDADES, type Material } from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, type UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import { Etapas } from '../components/Etapas';
import { Alerta, Campo, Input, InputMascara, Marcador, Select, TextoSuave } from '../components/ui';
import { api } from '../lib/api';
import { useAssistente, type EtapaDef } from '../lib/assistente';
import { useOpcoes } from '../lib/cadastro';
import { aplicarErrosDaApi } from '../lib/formulario';
import { arvoreCategorias, useCategorias, useMarcas } from '../lib/materiais';
import { NavegacaoEtapas } from './VeiculoForm';

type Entrada = z.input<typeof materialInputSchema>;
type Saida = z.output<typeof materialInputSchema>;
type Form = UseFormReturn<Entrada, unknown, Saida>;

const valoresIniciais = (m?: Material): Entrada =>
  m
    ? {
        sku: m.sku,
        codigoBarras: m.codigoBarras ?? '',
        descricao: m.descricao,
        descricaoCurta: m.descricaoCurta ?? '',
        tipoId: m.tipoId,
        categoriaId: m.categoriaId,
        marcaId: m.marcaId ?? '',
        unidade: m.unidade,
        codigoFabricante: m.codigoFabricante ?? '',
        ncm: m.ncm ? mascaraNcm(m.ncm) : '',
        cest: m.cest ? mascaraCest(m.cest) : '',
        origem: m.origem ?? '',
        controlaEstoque: m.controlaEstoque,
        permiteVenda: m.permiteVenda,
        permiteCompra: m.permiteCompra,
        permiteUsoOs: m.permiteUsoOs,
        controlaLote: m.controlaLote,
        controlaSerie: m.controlaSerie,
      }
    : {
        sku: '',
        codigoBarras: '',
        descricao: '',
        descricaoCurta: '',
        tipoId: '',
        categoriaId: '',
        marcaId: '',
        unidade: 'UN',
        codigoFabricante: '',
        ncm: '',
        cest: '',
        origem: '',
        controlaEstoque: true,
        permiteVenda: true,
        permiteCompra: true,
        permiteUsoOs: true,
        controlaLote: false,
        controlaSerie: false,
      };

const ETAPAS: EtapaDef[] = [
  { titulo: 'Identificação', campos: ['sku', 'descricao', 'descricaoCurta', 'unidade', 'codigoBarras', 'codigoFabricante'] },
  { titulo: 'Classificação', campos: ['tipoId', 'categoriaId', 'marcaId'] },
  { titulo: 'Fiscal', campos: ['ncm', 'cest', 'origem'] },
  { titulo: 'Controles', campos: ['controlaEstoque', 'permiteVenda', 'permiteCompra', 'permiteUsoOs', 'controlaLote', 'controlaSerie'] },
];

/** Cadastro de material em etapas; na edição, etapas livres e controle de versão (quem salvou antes vence). */
export function MaterialForm({ material, aoSalvar, aoCancelar }: { material?: Material; aoSalvar: (m: Material) => void; aoCancelar: () => void }) {
  const queryClient = useQueryClient();
  const livre = !!material;
  const form = useForm<Entrada, unknown, Saida>({ resolver: zodResolver(materialInputSchema), defaultValues: valoresIniciais(material), mode: 'onTouched' });
  const assistente = useAssistente(form, ETAPAS);
  const salvar = useMutation({
    mutationFn: (dados: Saida) =>
      api<Material>(material ? `/materiais/${material.id}` : '/materiais', { method: material ? 'PUT' : 'POST', body: { ...dados, versao: material?.versao } }),
    onSuccess: (salvo) => {
      queryClient.invalidateQueries({ queryKey: ['materiais'] });
      queryClient.invalidateQueries({ queryKey: ['categorias'] });
      queryClient.invalidateQueries({ queryKey: ['marcas'] });
      queryClient.invalidateQueries({ queryKey: ['opcoes'] });
      aoSalvar(salvo);
    },
  });
  const enviar = form.handleSubmit((d) => salvar.mutate(d), assistente.aoInvalido);

  return (
    <form className="space-y-6" noValidate onSubmit={(e) => assistente.interceptarEnvio(e, livre) || enviar(e)}>
      <Etapas titulos={ETAPAS.map((e) => e.titulo)} atual={assistente.etapa} aoIr={assistente.irPara} livre={livre} comErro={assistente.comErro} />
      <Alerta>{salvar.isError && aplicarErrosDaApi(salvar.error, form.setError)}</Alerta>
      {assistente.etapa === 0 && <EtapaIdentificacao form={form} />}
      {assistente.etapa === 1 && <EtapaClassificacao form={form} material={material} />}
      {assistente.etapa === 2 && <EtapaFiscal form={form} />}
      {assistente.etapa === 3 && <EtapaControles form={form} />}
      <NavegacaoEtapas assistente={assistente} livre={livre} salvando={salvar.isPending} rotuloSalvar={livre ? 'Salvar alterações' : 'Cadastrar material'} aoCancelar={aoCancelar} />
    </form>
  );
}

function EtapaIdentificacao({ form }: { form: Form }) {
  const erros = form.formState.errors;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Campo rotulo="SKU *" dica="Código interno do material, único na oficina" erro={erros.sku}>
        <InputMascara autoFocus placeholder="FIL-001" registro={form.register('sku')} mascara={mascaraCodigo} />
      </Campo>
      <div className="md:col-span-2">
        <Campo rotulo="Descrição *" erro={erros.descricao}>
          <Input placeholder="Filtro de óleo W712" {...form.register('descricao')} />
        </Campo>
      </div>
      <Campo rotulo="Descrição curta" dica="Até 40 caracteres, para etiquetas e cupons" erro={erros.descricaoCurta}>
        <Input maxLength={40} {...form.register('descricaoCurta')} />
      </Campo>
      <Campo rotulo="Unidade *" erro={erros.unidade}>
        <Select {...form.register('unidade')}>
          {Object.entries(UNIDADES).map(([sigla, u]) => (
            <option key={sigla} value={sigla}>
              {sigla} — {u.nome}
            </option>
          ))}
        </Select>
      </Campo>
      <Campo rotulo="Código de barras (EAN/GTIN)" erro={erros.codigoBarras}>
        <InputMascara inputMode="numeric" placeholder="7891234567895" registro={form.register('codigoBarras')} mascara={mascaraGtin} />
      </Campo>
      <Campo rotulo="Código do fabricante" dica="Part number da peça" erro={erros.codigoFabricante}>
        <InputMascara registro={form.register('codigoFabricante')} mascara={(v) => v.toUpperCase()} />
      </Campo>
    </div>
  );
}

function EtapaClassificacao({ form, material }: { form: Form; material?: Material }) {
  const erros = form.formState.errors;
  const tipos = useOpcoes('tiposMaterial');
  const categorias = useCategorias();
  const marcas = useMarcas();
  // Só itens ativos na escolha, mais o que o material já usa (mesmo se inativado depois).
  const arvore = arvoreCategorias(categorias.data).filter((c) => c.ativa || c.id === material?.categoriaId);
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Campo rotulo="Tipo *" erro={erros.tipoId}>
        <Select disabled={tipos.isPending} {...form.register('tipoId')}>
          <option value="">—</option>
          {tipos.data
            ?.filter((t) => t.ativa || t.id === material?.tipoId)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
        </Select>
      </Campo>
      <Campo rotulo="Categoria *" dica={arvore.length ? undefined : 'Cadastre categorias em Materiais → Categorias'} erro={erros.categoriaId}>
        <Select disabled={categorias.isPending} {...form.register('categoriaId')}>
          <option value="">—</option>
          {arvore.map((c) => (
            <option key={c.id} value={c.id}>
              {'   '.repeat(c.nivel)}
              {c.nome}
            </option>
          ))}
        </Select>
      </Campo>
      <Campo rotulo="Marca" erro={erros.marcaId}>
        <Select disabled={marcas.isPending} {...form.register('marcaId')}>
          <option value="">Sem marca</option>
          {marcas.data
            ?.filter((m) => m.ativa || m.id === material?.marcaId)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
        </Select>
      </Campo>
    </div>
  );
}

function EtapaFiscal({ form }: { form: Form }) {
  const erros = form.formState.errors;
  return (
    <div className="space-y-4">
      <TextoSuave>Dados usados na nota fiscal. Opcionais agora; o módulo fiscal poderá exigi-los.</TextoSuave>
      <div className="grid gap-4 md:grid-cols-3">
        <Campo rotulo="NCM" erro={erros.ncm}>
          <InputMascara inputMode="numeric" placeholder="0000.00.00" registro={form.register('ncm')} mascara={mascaraNcm} />
        </Campo>
        <Campo rotulo="CEST" erro={erros.cest}>
          <InputMascara inputMode="numeric" placeholder="00.000.00" registro={form.register('cest')} mascara={mascaraCest} />
        </Campo>
        <Campo rotulo="Origem da mercadoria" erro={erros.origem}>
          <Select {...form.register('origem')}>
            <option value="">—</option>
            {ORIGENS_FISCAIS.map((o, i) => (
              <option key={i} value={i}>
                {i} — {o}
              </option>
            ))}
          </Select>
        </Campo>
      </div>
    </div>
  );
}

const CONTROLES = [
  { campo: 'controlaEstoque', rotulo: 'Controla estoque', dica: 'Desmarque para itens consumidos sem controle de saldo.' },
  { campo: 'permiteVenda', rotulo: 'Permite venda', dica: 'Pode ser vendido no balcão.' },
  { campo: 'permiteCompra', rotulo: 'Permite compra', dica: 'Pode entrar em pedidos de compra.' },
  { campo: 'permiteUsoOs', rotulo: 'Permite uso em O.S.', dica: 'Pode ser adicionado a ordens de serviço.' },
  { campo: 'controlaLote', rotulo: 'Controla lote', dica: 'Exigirá lote nas entradas e saídas (ex.: óleos, fluidos).' },
  { campo: 'controlaSerie', rotulo: 'Controla número de série', dica: 'Exigirá o número de série de cada unidade (ex.: baterias).' },
] as const;

function EtapaControles({ form }: { form: Form }) {
  return (
    <div className="space-y-3">
      <TextoSuave>Regras que os módulos de estoque, compras, vendas e O.S. vão respeitar.</TextoSuave>
      <div className="grid gap-3 md:grid-cols-2">
        {CONTROLES.map((c) => (
          <div key={c.campo} className="rounded-md border border-borda p-3">
            <Marcador rotulo={<span className="font-medium">{c.rotulo}</span>} {...form.register(c.campo)} />
            <p className="mt-1 pl-6 text-xs text-texto-suave">{c.dica}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
