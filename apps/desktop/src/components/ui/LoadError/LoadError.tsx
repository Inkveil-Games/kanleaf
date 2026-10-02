import { TriangleAlert } from 'lucide-react';
import { Button } from '../Button';
import { EmptyState, type EmptyStateProps } from '../EmptyState';

export interface LoadErrorProps extends Omit<
  EmptyStateProps,
  'action' | 'icon'
> {
  onRetry?: () => void;
  retrying?: boolean;
}

export function LoadError({
  onRetry,
  retrying = false,
  ...props
}: LoadErrorProps) {
  return (
    <EmptyState
      {...props}
      role="alert"
      data-state="error"
      icon={<TriangleAlert size={18} />}
      action={
        onRetry ? (
          <Button
            className="ui-load-error-retry"
            variant="secondary"
            size="sm"
            onClick={onRetry}
            loading={retrying}
            loadingLabel="Trying again"
          >
            Try again
          </Button>
        ) : undefined
      }
    />
  );
}
