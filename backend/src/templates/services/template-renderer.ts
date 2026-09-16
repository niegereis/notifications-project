import { Injectable } from '@nestjs/common';

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

export class MissingTemplateVariablesError extends Error {
  constructor(readonly variables: string[]) {
    super(`O payload não tem as variáveis exigidas pelo template: ${variables.join(', ')}.`);
    this.name = 'MissingTemplateVariablesError';
  }
}

function stringifyValue(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
    case 'symbol':
      return value.toString();
    default:
      return JSON.stringify(value) ?? '';
  }
}

@Injectable()
export class TemplateRenderer {
  render(template: string, payload: Record<string, unknown>): string {
    const missing = new Set<string>();

    const rendered = template.replace(PLACEHOLDER, (_match, variable: string) => {
      const value = payload[variable];

      if (value === undefined || value === null || value === '') {
        missing.add(variable);
        return '';
      }

      return stringifyValue(value);
    });

    if (missing.size > 0) {
      throw new MissingTemplateVariablesError([...missing]);
    }

    return rendered;
  }

  variablesOf(template: string): string[] {
    return [...new Set([...template.matchAll(PLACEHOLDER)].map(([, variable]) => variable))];
  }
}
