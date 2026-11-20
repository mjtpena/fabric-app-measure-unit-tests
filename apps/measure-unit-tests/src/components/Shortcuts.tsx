import { Dialog, Kbd } from '@x10/shared/ui';

export interface Shortcut {
  keys: string[];
  label: string;
}

/** The `?` cheat sheet. */
export function Shortcuts({ open, onClose, items }: { open: boolean; onClose: () => void; items: Shortcut[] }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts">
      <dl className="m-0 divide-y divide-[var(--line)]">
        {items.map((s) => (
          <div key={s.label} className="flex items-center justify-between gap-4 py-2">
            <dt className="text-sm">{s.label}</dt>
            <dd className="m-0 flex gap-1">
              {s.keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
