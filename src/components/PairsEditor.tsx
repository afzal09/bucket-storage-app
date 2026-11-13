import { Plus, X } from 'lucide-react';
import type { Pair } from '../lib/pairs';

interface PairsEditorProps {
  pairs: Pair[];
  onChange: (pairs: Pair[]) => void;
  keyLabel?: string;
  valueLabel?: string;
  addLabel?: string;
  keyPlaceholder?: string;
}

export function PairsEditor({
  pairs,
  onChange,
  keyLabel = 'Key',
  valueLabel = 'Value',
  addLabel = 'Add',
  keyPlaceholder,
}: PairsEditorProps) {
  const update = (index: number, change: Partial<Pair>) =>
    onChange(pairs.map((pair, i) => (i === index ? { ...pair, ...change } : pair)));

  return (
    <div className="pairs">
      {pairs.map((pair, index) => (
        <div className="pairs-row" key={index}>
          <input aria-label={`${keyLabel} ${index + 1}`} placeholder={keyPlaceholder ?? keyLabel} value={pair.key} onChange={(e) => update(index, { key: e.target.value })} autoComplete="off" spellCheck={false} />
          <input aria-label={`${valueLabel} ${index + 1}`} placeholder={valueLabel} value={pair.value} onChange={(e) => update(index, { value: e.target.value })} autoComplete="off" />
          <button type="button" className="icon-btn" aria-label={`Remove ${keyLabel.toLowerCase()} ${index + 1}`} onClick={() => onChange(pairs.filter((_, i) => i !== index))}>
            <X size={16} />
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={() => onChange([...pairs, { key: '', value: '' }])}>
        <Plus size={14} />
        {addLabel}
      </button>
    </div>
  );
}
