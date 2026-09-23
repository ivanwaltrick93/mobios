import { useState, type FormEvent } from 'react';
import type { FieldErrors, FieldValues, FormState, Path, UseFormTrigger } from 'react-hook-form';

export type EtapaDef = { titulo: string; campos: string[] };

/**
 * Controla um cadastro em etapas. Cada etapa valida só os próprios campos antes de avançar.
 * `livre` (edição): qualquer etapa pode ser aberta e o salvar fica sempre disponível.
 */
export function useAssistente<T extends FieldValues>(form: { trigger: UseFormTrigger<T>; formState: FormState<T> }, etapas: EtapaDef[], inicial = 0) {
  const [etapa, setEtapa] = useState(Math.min(inicial, etapas.length - 1));
  const erros = Object.keys(form.formState.errors);
  const comErro = etapas.flatMap((e, i) => (e.campos.some((c) => erros.includes(c)) ? [i] : []));
  const ultima = etapa === etapas.length - 1;

  async function avancar() {
    if (await form.trigger(etapas[etapa]!.campos as Path<T>[])) {
      setEtapa((e) => Math.min(e + 1, etapas.length - 1));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  return {
    etapa,
    irPara: setEtapa,
    avancar,
    voltar: () => setEtapa((e) => Math.max(0, e - 1)),
    ultima,
    comErro,
    /** Ao salvar com erro, abre a primeira etapa com problema. */
    aoInvalido: (e: FieldErrors) => {
      const i = etapas.findIndex((def) => def.campos.some((c) => c in e));
      if (i >= 0) setEtapa(i);
    },
    /** Enter numa etapa intermediária do cadastro novo avança em vez de salvar. */
    interceptarEnvio: (ev: FormEvent, livre: boolean) => {
      if (livre || ultima) return false;
      ev.preventDefault();
      avancar();
      return true;
    },
  };
}
