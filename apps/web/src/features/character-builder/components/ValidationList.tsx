import type { ValidationReport } from '@blockwright/shared';

export function ValidationList({ report, hideInfo }: { report: ValidationReport; hideInfo?: boolean }) {
  const issues = report.issues.filter((i) => !hideInfo || i.severity !== 'info');
  return (
    <div>
      <p className={`font-pixel mb-1 ${report.ok ? 'text-grass' : 'text-redstone'}`}>
        {report.ok ? '✔ Passed' : '✖ Not exportable yet'} <span className="text-xs text-muted">({report.checks.length} checks)</span>
      </p>
      {issues.length > 0 && (
        <ul className="space-y-1 text-sm">
          {issues.map((i, n) => (
            <li key={`${i.code}-${n}`} className={i.severity === 'error' ? 'text-redstone' : i.severity === 'warning' ? 'text-gold' : 'text-muted'}>
              <span className="font-pixel text-xs uppercase">{i.severity}</span> {i.message}
              {i.path && <span className="text-xs text-muted"> ({i.path})</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
