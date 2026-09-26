// Schema do banco, dividido por domínio em ./schema/. O drizzle-kit lê este arquivo e segue os re-exports.

export * from './schema/comum.js';
export * from './schema/oficina.js';
export * from './schema/clientes.js';
export * from './schema/materiais.js';
export * from './schema/estoque.js';
export * from './schema/vendedores.js';
export * from './schema/orcamentos.js';
export * from './schema/ordensServico.js';
export * from './schema/aprovacoes.js';
