import { Check } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { Popover, PopoverClose } from './Popover';
import { COLOR_SWATCH_PALETTE, normalizeHexColor } from './colorSwatches';

interface ColorSwatchPickerProps {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function ColorSwatchPicker({
  ariaLabel,
  value,
  onChange,
  disabled = false,
}: ColorSwatchPickerProps) {
  const normalizedValue = normalizeHexColor(value) ?? '#64748B';
  const [open, setOpen] = useState(false);
  const [customColor, setCustomColor] = useState(normalizedValue);
  const normalizedCustomColor = normalizeHexColor(customColor);

  return (
    <Popover
      className="color-swatch-picker"
      label={ariaLabel}
      align="start"
      disabled={disabled}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setCustomColor(normalizedValue);
      }}
      trigger={
        <span
          className="color-swatch-trigger"
          style={{ '--swatch-color': normalizedValue } as CSSProperties}
        >
          <span className="color-swatch-trigger-dot" aria-hidden="true" />
        </span>
      }
    >
      <div className="color-swatch-popover">
        <strong>Color</strong>
        <div className="color-swatch-palette" aria-label="Color palette">
          {COLOR_SWATCH_PALETTE.map((color) => (
            <PopoverClose
              key={color.value}
              className="color-swatch-option"
              ariaLabel={color.label}
              ariaPressed={color.value === normalizedValue}
              onClick={() => onChange(color.value)}
            >
              <span
                style={{ '--swatch-color': color.value } as CSSProperties}
                aria-hidden="true"
              />
              {color.value === normalizedValue ? (
                <Check aria-hidden="true" size={12} />
              ) : null}
            </PopoverClose>
          ))}
        </div>
        <label className="color-swatch-custom">
          <span>Custom</span>
          <span>
            <input
              aria-label="Custom color"
              maxLength={7}
              spellCheck={false}
              value={customColor}
              onChange={(event) => setCustomColor(event.target.value)}
            />
            <PopoverClose
              className="secondary-button compact-button"
              ariaLabel="Use custom color"
              disabled={!normalizedCustomColor}
              onClick={() => {
                if (normalizedCustomColor) onChange(normalizedCustomColor);
              }}
            >
              Use
            </PopoverClose>
          </span>
        </label>
      </div>
    </Popover>
  );
}
