type DangerousActionOptions = {
  title: string;
  message: string;
  confirmationText: string;
};

export function confirmDangerousAction({
  title,
  message,
  confirmationText
}: DangerousActionOptions) {
  const response = window.prompt(
    `${title}\n\n${message}\n\nType ${confirmationText} to continue.`
  );
  return response === confirmationText;
}
