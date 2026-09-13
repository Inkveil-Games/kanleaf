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
        <img
          src="/brand/kanleaf-mark.png"
          alt=""
          width="28"
          height="28"
          draggable="false"
        />
      </span>
      <span>Kanleaf</span>
    </div>
  );
}
