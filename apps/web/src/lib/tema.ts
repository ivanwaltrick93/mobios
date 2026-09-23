import { TEMA_PADRAO, type Tema } from '@mobios/shared';

/** Luminância relativa (WCAG) de uma cor #rrggbb. */
function luminancia(hex: string): number {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

const contraste = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** Texto branco ou escuro, o que tiver mais contraste com o fundo informado. */
export function textoSobre(fundo: string, escuro = '#0f172a'): string {
  const l = luminancia(fundo);
  return contraste(l, 1) >= contraste(l, luminancia(escuro)) ? '#ffffff' : escuro;
}

/** Aplica as cores da oficina nos tokens do style guide (index.css). null = padrão. */
export function aplicarTema(tema: Tema) {
  const raiz = document.documentElement.style;
  const primaria = tema.corPrimaria ?? TEMA_PADRAO.corPrimaria;
  const menu = tema.corMenu ?? TEMA_PADRAO.corMenu;
  raiz.setProperty('--cor-primaria', primaria);
  raiz.setProperty('--cor-sobre-primaria', textoSobre(primaria));
  raiz.setProperty('--cor-menu', menu);
  raiz.setProperty('--cor-menu-texto', textoSobre(menu, '#334155'));
}

/** A versão na URL muda a cada novo logo, então o navegador pode guardar a imagem em cache sem risco. */
export const urlLogo = (versao: string) => `/api/configuracoes/logo?v=${versao}`;
