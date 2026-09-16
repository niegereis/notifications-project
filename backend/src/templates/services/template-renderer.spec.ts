import { MissingTemplateVariablesError, TemplateRenderer } from './template-renderer.js';

describe('TemplateRenderer', () => {
  const renderer = new TemplateRenderer();

  it('substitui os marcadores pelos valores do payload', () => {
    const result = renderer.render('Olá {{nome}}, pedido {{numero}} a caminho.', {
      nome: 'Ana',
      numero: 1234,
    });

    expect(result).toBe('Olá Ana, pedido 1234 a caminho.');
  });

  it('aceita espaços dentro dos marcadores', () => {
    expect(renderer.render('Olá {{ nome }}', { nome: 'Ana' })).toBe('Olá Ana');
  });

  it('repete o mesmo valor em marcadores repetidos', () => {
    expect(renderer.render('{{nome}} e {{nome}}', { nome: 'Ana' })).toBe('Ana e Ana');
  });

  it('recusa o render quando falta variável, em vez de deixar buraco no texto', () => {
    expect(() => renderer.render('Olá {{nome}}, código {{codigo}}', { nome: 'Ana' })).toThrow(
      MissingTemplateVariablesError,
    );
  });

  it('lista todas as variáveis que faltaram', () => {
    try {
      renderer.render('{{a}} {{b}} {{c}}', { b: 'ok' });
      expect.unreachable('deveria ter lançado');
    } catch (error) {
      expect(error).toBeInstanceOf(MissingTemplateVariablesError);
      expect((error as MissingTemplateVariablesError).variables).toEqual(['a', 'c']);
    }
  });

  it('trata string vazia como variável ausente', () => {
    expect(() => renderer.render('Olá {{nome}}', { nome: '' })).toThrow(
      MissingTemplateVariablesError,
    );
  });

  it('lista as variáveis exigidas por um template', () => {
    expect(renderer.variablesOf('Olá {{nome}}, pedido {{numero}} ({{nome}})')).toEqual([
      'nome',
      'numero',
    ]);
  });
});
