/** Walkthrough note: Keyboard-focusable inline definitions for business metrics. */
interface InfoTipProps {
  text: string;
}

export function InfoTip({ text }: InfoTipProps) {
  return (
    <span className="info-tip" tabIndex={0}>
      <span className="info-tip-icon" aria-hidden="true">
        i
      </span>
      <span className="info-tip-text" role="tooltip">
        {text}
      </span>
    </span>
  );
}
