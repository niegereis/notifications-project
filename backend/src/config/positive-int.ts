/**
 * Lê uma configuração numérica opcional vinda de `ConfigService.get`.
 *
 * O compose passa variáveis não definidas como string vazia, e o `ConfigService`
 * devolve esse valor bruto (a validação transforma '' em undefined só na cópia
 * validada). Sem esta checagem, '' chegaria a `prefetch('')`, que o RabbitMQ
 * trata como 0: sem limite de mensagens em voo.
 */
export function positiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);

  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}
