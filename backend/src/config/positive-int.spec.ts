import { positiveInt } from './positive-int.js';

describe('positiveInt', () => {
  it('devolve o fallback para undefined, vazio e lixo', () => {
    expect(positiveInt(undefined, 1)).toBe(1);
    expect(positiveInt('', 1)).toBe(1);
    expect(positiveInt('   ', 1)).toBe(1);
    expect(positiveInt('abc', 1)).toBe(1);
    expect(positiveInt(null, 7)).toBe(7);
  });

  it('rejeita zero, negativos e decimais (0 viraria "sem limite" no prefetch)', () => {
    expect(positiveInt(0, 1)).toBe(1);
    expect(positiveInt('0', 1)).toBe(1);
    expect(positiveInt(-3, 1)).toBe(1);
    expect(positiveInt('2.5', 1)).toBe(1);
  });

  it('aceita inteiros positivos como número ou string', () => {
    expect(positiveInt(20, 1)).toBe(20);
    expect(positiveInt('20', 1)).toBe(20);
  });
});
