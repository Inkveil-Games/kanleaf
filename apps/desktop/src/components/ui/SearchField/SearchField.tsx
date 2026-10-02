import { Search, X } from 'lucide-react';
import { forwardRef, useRef, type ReactNode } from 'react';
import { IconButton } from '../IconButton';
import { Input, type InputProps } from '../Input';
import { Tooltip } from '../Tooltip';
import './SearchField.css';

export interface SearchFieldProps extends Omit<
  InputProps,
  'value' | 'defaultValue' | 'onChange' | 'type'
> {
  value: string;
  onValueChange: (value: string) => void;
  'aria-label': string;
  clearLabel?: string;
  inputClassName?: string;
  trailing?: ReactNode;
  appearance?: 'outline' | 'underline';
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(
  function SearchField(
    {
      value,
      onValueChange,
      clearLabel = 'Clear search',
      className,
      inputClassName,
      trailing,
      appearance = 'outline',
      disabled,
      readOnly,
      onKeyDown,
      onCompositionStart,
      onCompositionEnd,
      onBlur,
      ...inputProps
    },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const composingRef = useRef(false);
    const canClear = value.length > 0 && !disabled && !readOnly;

    function clear() {
      onValueChange('');
      inputRef.current?.focus();
    }

    return (
      <div
        className={`ui-search-field${className ? ` ${className}` : ''}`}
        data-appearance={appearance}
        data-disabled={disabled || undefined}
      >
        <Search size={14} aria-hidden="true" />
        <Input
          {...inputProps}
          ref={(node) => {
            inputRef.current = node;
            if (typeof ref === 'function') return ref(node);
            if (ref) ref.current = node;
          }}
          className={inputClassName}
          type="search"
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          onChange={(event) => onValueChange(event.target.value)}
          onCompositionStart={(event) => {
            composingRef.current = true;
            onCompositionStart?.(event);
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            onCompositionEnd?.(event);
          }}
          onBlur={(event) => {
            composingRef.current = false;
            onBlur?.(event);
          }}
          onKeyDown={(event) => {
            if (
              composingRef.current ||
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229
            ) {
              event.stopPropagation();
              return;
            }
            if (event.key === 'Escape' && canClear) {
              event.preventDefault();
              event.stopPropagation();
              clear();
              return;
            }
            onKeyDown?.(event);
          }}
        />
        {canClear ? (
          <Tooltip
            label={clearLabel}
            trigger={
              <IconButton aria-label={clearLabel} onClick={clear}>
                <X size={14} aria-hidden="true" />
              </IconButton>
            }
          />
        ) : (
          trailing
        )}
      </div>
    );
  },
);
