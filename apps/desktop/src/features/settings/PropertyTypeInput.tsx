import { Input } from '../../components/ui/Input';
import { useFormFieldControl } from '../../components/ui/FormField/FormFieldContext';
import { Tooltip } from '../../components/ui/Tooltip';

export function PropertyTypeInput({ value }: { value: string }) {
  const field = useFormFieldControl({});
  return (
    <Tooltip
      label="Type cannot be changed after creation."
      trigger={
        <Input
          id={field.id}
          aria-label="Property type"
          aria-description="Type cannot be changed after creation."
          readOnly
          value={value}
        />
      }
    />
  );
}
