type ActionFeedbackTone = 'success' | 'error' | 'info';

type ActionFeedbackProps = {
  message?: string | null;
  tone?: ActionFeedbackTone;
};

export function ActionFeedback({ message, tone = 'success' }: ActionFeedbackProps) {
  if (!message) return null;

  return (
    <span className={`action-feedback action-feedback-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {message}
    </span>
  );
}
