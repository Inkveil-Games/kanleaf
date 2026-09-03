import { Blocks } from 'lucide-react';
import { IconPicker } from '../../../components/ui/IconPicker';
import { projectIconOptions } from '../projectIcons';

interface ProjectIconPickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function ProjectIconPicker({
  value,
  onChange,
  disabled = false,
}: ProjectIconPickerProps) {
  return (
    <IconPicker
      ariaLabel="Choose Project icon"
      className="project-icon-picker"
      dialogLabel="Project icons"
      disabled={disabled}
      fallbackIcon={Blocks}
      iconSize={24}
      options={projectIconOptions}
      value={value}
      onChange={onChange}
    />
  );
}
