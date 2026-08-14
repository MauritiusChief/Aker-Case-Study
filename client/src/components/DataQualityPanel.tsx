import type { DataQualityIssue } from "../types";

interface DataQualityPanelProps {
  issues: DataQualityIssue[];
}

export function DataQualityPanel({ issues }: DataQualityPanelProps) {
  if (issues.length === 0) {
    return (
      <div className="quality-card quality-ok">
        <div className="card-header">
          <h3>Data Quality</h3>
        </div>
        <p>No data quality issues detected for this snapshot.</p>
      </div>
    );
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;

  return (
    <div className="quality-card">
      <div className="card-header">
        <h3>Data Quality</h3>
        <span className="card-subtitle">
          {errors} error(s), {warnings} warning(s)
        </span>
      </div>
      <ul className="quality-list">
        {issues.map((issue, index) => {
          const scope = [issue.property_code, issue.unit_code, issue.resident_id]
            .filter(Boolean)
            .join(" / ");
          return (
            <li key={index} className={`quality-item quality-${issue.severity}`}>
              <span className="quality-code">{issue.code}</span>
              <span className="quality-message">
                {issue.message}
                {scope ? <span className="quality-scope"> ({scope})</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
