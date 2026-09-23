import { TEMA_PADRAO, type Tema } from '@mobios/shared';

/** Luminância relativa (WCAG) de uma cor #rrggbb. */
function luminancia(hex: string): number {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

/** Razão de contraste WCAG entre duas cores (1 a 21). Texto normal pede ao menos 4,5. */
export function contraste(a: string, b: string): number {
  const [la, lb] = [luminancia(a), luminancia(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const CONTRASTE_MINIMO = 4.5;

/** Texto branco ou escuro, o que tiver mais contraste com o fundo informado. */
export function textoSobre(fundo: string, escuro = '#0f172a'): string {
  return contraste(fundo, '#ffffff') >= contraste(fundo, escuro) ? '#ffffff' : escuro;
}

/** Cores efetivas do tema: aplica padrões e o contraste automático dos textos não configurados. */
export function resolverTema(tema: Tema) {
  const primaria = tema.corPrimaria ?? TEMA_PADRAO.corPrimaria;
  const menu = tema.corMenu ?? TEMA_PADRAO.corMenu;
  const botaoPrimario = tema.corBotaoPrimario ?? primaria;
  const botaoSecundario = tema.corBotaoSecundario ?? TEMA_PADRAO.corBotaoSecundario;
  return {
    '--cor-primaria': primaria,
    '--cor-sobre-primaria': textoSobre(primaria),
    '--cor-menu': menu,
    '--cor-menu-texto': textoSobre(menu, '#334155'),
    '--cor-botao-primario': botaoPrimario,
    '--cor-botao-primario-texto': tema.corBotaoPrimarioTexto ?? textoSobre(botaoPrimario),
    '--cor-botao-secundario': botaoSecundario,
    '--cor-botao-secundario-texto': tema.corBotaoSecundarioTexto ?? textoSobre(botaoSecundario),
  };
}

/** Aplica as cores da oficina nos tokens do style guide (index.css). */
export function aplicarTema(tema: Tema) {
  const raiz = document.documentElement.style;
  for (const [token, valor] of Object.entries(resolverTema(tema))) raiz.setProperty(token, valor);
}

/** A versão na URL muda a cada novo logo, então o navegador pode guardar a imagem em cache sem risco. */
export const urlLogo = (versao: string) => `/api/configuracoes/logo?v=${versao}`;
export const urlLogoPublico = (versao: string, oficinaId: string | null) =>
  `/api/publico/logo?${new URLSearchParams({ v: versao, ...(oficinaId && { oficina: oficinaId }) })}`;
