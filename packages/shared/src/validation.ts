import { z } from 'zod';

export const ValidationSeveritySchema = z.enum(['error', 'warning', 'info']);
export type ValidationSeverity = z.infer<typeof ValidationSeveritySchema>;

export const ValidationIssueSchema = z.object({
  code: z.string(),
  severity: ValidationSeveritySchema,
  message: z.string(),
  /** Optional location such as a file path inside an archive or a skin region. */
  path: z.string().optional(),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const ValidationReportSchema = z.object({
  ok: z.boolean(),
  /** Names of the checks that were executed (so "ok" is never vacuous). */
  checks: z.array(z.string()),
  issues: z.array(ValidationIssueSchema),
});
export type ValidationReport = z.infer<typeof ValidationReportSchema>;

/** Small helper that accumulates checks and issues and derives `ok`. */
export class ReportBuilder {
  readonly checks: string[] = [];
  readonly issues: ValidationIssue[] = [];

  check(name: string): this {
    this.checks.push(name);
    return this;
  }

  error(code: string, message: string, path?: string): this {
    this.issues.push({ code, severity: 'error', message, ...(path ? { path } : {}) });
    return this;
  }

  warn(code: string, message: string, path?: string): this {
    this.issues.push({ code, severity: 'warning', message, ...(path ? { path } : {}) });
    return this;
  }

  info(code: string, message: string, path?: string): this {
    this.issues.push({ code, severity: 'info', message, ...(path ? { path } : {}) });
    return this;
  }

  merge(other: ValidationReport): this {
    this.checks.push(...other.checks);
    this.issues.push(...other.issues);
    return this;
  }

  build(): ValidationReport {
    return {
      ok: !this.issues.some((i) => i.severity === 'error'),
      checks: [...this.checks],
      issues: [...this.issues],
    };
  }
}
