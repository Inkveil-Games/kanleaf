interface WordmarkProps {
  quiet?: boolean;
}

export function Wordmark({ quiet = false }: WordmarkProps) {
  return (
    <div
      className={`wordmark${quiet ? ' wordmark-quiet' : ''}`}
      aria-label="Kanleaf"
    >
      <span className="wordmark-mark" aria-hidden="true">
        K
      </span>
      <span>Kanleaf</span>
    </div>
  );
}
