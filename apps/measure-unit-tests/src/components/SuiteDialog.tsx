import { useEffect, useId, useState } from 'react';

import { describeError } from '@x10/shared/lib';
import { Button, Dialog, Field, InlineError, Input, TextArea } from '@x10/shared/ui';

import { checkSuite, type SuiteInput } from '../domain/suites';
import { limits, type TestSuite } from '../model';

/** Create or edit a suite. `onSave` does the write; the dialog closes when it resolves. */
export function SuiteDialog({
  open,
  onClose,
  suite,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  suite?: TestSuite | null;
  onSave: (input: SuiteInput) => Promise<void>;
}) {
  const [form, setForm] = useState<SuiteInput>({ name: '', description: '' });
  const [errors, setErrors] = useState<{ name?: string; description?: string }>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    setForm({ name: suite?.name ?? '', description: suite?.description ?? '' });
    setErrors({});
    setSaveError(null);
  }, [open, suite]);

  const submit = async () => {
    const errs = checkSuite(form);
    setErrors(errs);
    if (errs.name || errs.description) return;
    setBusy(true);
    setSaveError(null);
    try {
      await onSave(form);
      onClose();
    } catch (e) {
      setSaveError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={suite ? 'Edit suite' : 'New suite'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={submit}>
            {suite ? 'Save suite' : 'Create suite'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Suite name" htmlFor={nameId} required error={errors.name} counter={{ value: form.name.length, max: limits.suiteName.max }} hint="One suite per logical area, such as Sales or Inventory.">
          <Input id={nameId} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} invalid={!!errors.name} autoFocus />
        </Field>
        <Field label="Description" htmlFor={descId} error={errors.description} counter={{ value: form.description.length, max: limits.suiteDescription.max }}>
          <TextArea id={descId} value={form.description} rows={3} onChange={(e) => setForm({ ...form, description: e.target.value })} invalid={!!errors.description} />
        </Field>
        <button type="submit" className="sr-only" tabIndex={-1}>
          Save
        </button>
        <InlineError error={saveError} />
      </form>
    </Dialog>
  );
}
