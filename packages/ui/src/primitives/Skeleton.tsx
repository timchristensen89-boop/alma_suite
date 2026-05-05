type Props = {
  width?: string;
  height?: string;
  radius?: string;
  className?: string;
};

export function Skeleton({
  width = '100%',
  height = '1rem',
  radius = '8px',
  className = ''
}: Props) {
  return (
    <span
      className={`skeleton ${className}`.trim()}
      style={{ width, height, borderRadius: radius, display: 'inline-block' }}
    />
  );
}
