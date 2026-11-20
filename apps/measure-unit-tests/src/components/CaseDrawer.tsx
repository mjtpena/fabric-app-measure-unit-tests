import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Gauge, Lock, Trash2 } from 'lucide-react';

import type { ModelQueryResult } from '@x10/shared/connectors';
import { describeError } from '@x10/shared/lib';
import { Button, Checkbox, ConfirmDialog, cx, Dialog, Field, InlineError, Input, Select, StatusDot, TableWrap, Tabs, TextArea } from '@x10/shared/ui';

import { RUN_RULES } from '../config';
import { caseToInput, checkCase, emptyCaseInput, usesExpected, usesTolerance, type CaseErrors, type CaseInput } from '../domain/cases';
import { evaluate, formatValue, KIND_INFO, valueForExpected } from '../domain/compare';
import { buildMeasureQuery, checkMeasureInputs, checkRawDax, parseMeasureQuery } from '../domain/dax';
import { rowLimitFor } from '../domain/runner';
import { CASE_KINDS, limits, type CaseKind, type TestCase } from '../model';
import { useModelClient } from '../model-client';

type Mode = 'measure' | 'raw';

interface TestState {
  pending: boolean;
  result: ModelQueryResult | null;
  ms: number;
  dax: string;
}

const LIVE_DELAY_MS = 700;

/**
 * The Probe: add or edit a case. "Measure" mode builds the DAX from a measure name and an optional filter and takes a
 * live reading as you type; "Raw DAX" mode takes any query that starts with EVALUATE or DEFINE. "Test query" runs the
 * DAX once and "Use this value as expected" copies the reading into the case.
 */
export function CaseDrawer({
  open,
  onClose,
  testCase,
  canEdit,
  boardName,
  onSave,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  /** null = new case. */
  testCase: TestCase | null;
  canEdit: boolean;
  boardName?: string;
  onSave: (input: CaseInput) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const client = useModelClient();
  const [form, setForm] = useState<CaseInput>(emptyCaseInput);
  const [mode, setMode] = useState<Mode>('measure');
  const [measure, setMeasure] = useState('');
  const [filter, setFilter] = useState('');
  const [errors, setErrors] = useState<CaseErrors & { measure?: string; filter?: string }>({});
  const [test, setTest] = useState<TestState>({ pending: false, result: null, ms: 0, dax: '' });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const seq = useRef(0);
  const lastDax = useRef('');
  const initialDax = useRef('');
  const ids = {
    name: useId(),
    kind: useId(),
    measure: useId(),
    filter: useId(),
    dax: useId(),
    expected: useId(),
    tolerance: useId(),
    tags: useId(),
  };

  useEffect(() => {
    if (!open) return;
    const input = testCase ? caseToInput(testCase) : emptyCaseInput();
    setForm(input);
    const parsed = testCase ? parseMeasureQuery(testCase.dax) : { measure: '', filter: '' };
    setMode(parsed ? 'measure' : 'raw');
    setMeasure(parsed?.measure ?? '');
    setFilter(parsed?.filter ?? '');
    setErrors({});
    seq.current++;
    lastDax.current = '';
    initialDax.current = testCase?.dax.trim() ?? '';
    setTest({ pending: false, result: null, ms: 0, dax: '' });
    setSaveError(null);
  }, [open, testCase]);

  const builtDax = useMemo(() => {
    if (mode !== 'measure') return form.dax;
    const errs = checkMeasureInputs(measure, filter);
    if (errs.measure || errs.filter) return '';
    try {
      return buildMeasureQuery(measure, filter);
    } catch {
      return '';
    }
  }, [mode, measure, filter, form.dax]);

  const set = <K extends keyof CaseInput>(k: K, v: CaseInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    if (next === 'raw') set('dax', builtDax || form.dax);
    else {
      const parsed = parseMeasureQuery(form.dax);
      if (parsed) {
        setMeasure(parsed.measure);
        setFilter(parsed.filter);
      }
    }
    setErrors({});
    setMode(next);
  };

  /** Validate just the query; returns the DAX to run or null. */
  const queryOrErrors = (): string | null => {
    if (mode === 'measure') {
      const errs = checkMeasureInputs(measure, filter);
      setErrors((e) => ({ ...e, measure: errs.measure, filter: errs.filter, dax: undefined }));
      return errs.measure || errs.filter ? null : builtDax;
    }
    const msg = checkRawDax(form.dax);
    setErrors((e) => ({ ...e, dax: msg ?? undefined }));
    return msg ? null : form.dax.trim();
  };

  const execute = async (dax: string) => {
    const mine = ++seq.current;
    lastDax.current = dax;
    setTest((t) => ({ ...t, pending: true }));
    const t0 = performance.now();
    const result = await client.executeQuery(dax, { rowLimit: rowLimitFor(form.kind), timeoutMs: RUN_RULES.timeoutMs });
    if (mine !== seq.current) return;
    setTest({ pending: false, result, ms: Math.round(performance.now() - t0), dax });
  };

  const runTest = async () => {
    const dax = queryOrErrors();
    if (dax) await execute(dax);
  };

  // Live reading: in Measure mode, once the built query changes and settles, read it once.
  useEffect(() => {
    if (!open || mode !== 'measure' || !builtDax) return;
    if (builtDax === lastDax.current || builtDax === initialDax.current) return;
    const id = window.setTimeout(() => {
      if (builtDax !== lastDax.current) void execute(builtDax);
    }, LIVE_DELAY_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, builtDax]);

  const save = async () => {
    const dax = mode === 'measure' ? builtDax : form.dax;
    const input = { ...form, dax };
    const errs: CaseErrors & { measure?: string; filter?: string } = checkCase(input);
    if (mode === 'measure') {
      const m = checkMeasureInputs(measure, filter);
      delete errs.dax;
      Object.assign(errs, m);
    }
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    setBusy(true);
    setSaveError(null);
    try {
      await onSave(input);
      onClose();
    } catch (e) {
      setSaveError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const suggestion = test.result ? valueForExpected(form.kind, test.result) : null;
  const verdict =
    test.result && (form.kind === 'notblank' || form.expected.trim())
      ? evaluate(form.kind, test.result, form.expected, usesTolerance(form.kind) ? form.tolerance : '')
      : null;
  const ro = !canEdit;

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        drawer
        title={testCase ? (ro ? 'Probe' : 'Edit probe') : 'New probe'}
        description={boardName ? `${boardName} board · ${client.label}` : client.label}
        footer={
          ro ? (
            <Button onClick={onClose}>Close</Button>
          ) : (
            <>
              {testCase && onDelete && (
                <Button variant="ghost" icon={<Trash2 />} className="mr-auto text-bad-text" onClick={() => setConfirmDelete(true)}>
                  Delete case
                </Button>
              )}
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="primary" busy={busy} onClick={save}>
                {testCase ? 'Save case' : 'Add case'}
              </Button>
            </>
          )
        }
      >
        <div data-testid="case-drawer">
          {ro && (
            <p className="mt-0 mb-4 flex items-center gap-2 rounded-lg bg-surface-sunken px-3 py-2 text-ui text-muted">
              <Lock className="size-3.5 shrink-0" aria-hidden="true" />
              Only the suite owner or an admin can edit this case. You can still test its query.
            </p>
          )}
          <Field label="Name" htmlFor={ids.name} required error={errors.name} counter={{ value: form.name.length, max: limits.caseName.max }}>
            <Input id={ids.name} value={form.name} disabled={ro} onChange={(e) => set('name', e.target.value)} invalid={!!errors.name} placeholder="Units sold in 2025" />
          </Field>
          <Field label="Kind" htmlFor={ids.kind} hint={KIND_INFO[form.kind].expectedHint}>
            <Select id={ids.kind} value={form.kind} disabled={ro} onChange={(e) => set('kind', e.target.value as CaseKind)}>
              {CASE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_INFO[k].label}
                </option>
              ))}
            </Select>
          </Field>

          <Tabs
            label="Query mode"
            value={mode}
            onChange={switchMode}
            tabs={[
              { value: 'measure', label: 'Measure' },
              { value: 'raw', label: 'Raw DAX' },
            ]}
          />
          <div className="pt-3">
            {mode === 'measure' ? (
              <>
                <div className="grid gap-x-3 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                  <Field label="Measure" htmlFor={ids.measure} required error={errors.measure}>
                    <Input id={ids.measure} value={measure} disabled={ro} placeholder="[Total Sales]" className="font-mono" onChange={(e) => setMeasure(e.target.value)} invalid={!!errors.measure} />
                  </Field>
                  <Field label="Filter (optional)" htmlFor={ids.filter} error={errors.filter}>
                    <Input id={ids.filter} value={filter} disabled={ro} placeholder="'Date'[Year] = 2025" className="font-mono" onChange={(e) => setFilter(e.target.value)} invalid={!!errors.filter} />
                  </Field>
                </div>
                <div className="mb-4">
                  <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-surface-sunken px-3 py-2.5 font-mono text-ui text-fg" data-testid="built-dax">
                    {builtDax || 'Enter a measure to build the query.'}
                  </pre>
                </div>
              </>
            ) : (
              <Field label="DAX query" htmlFor={ids.dax} required error={errors.dax} counter={{ value: form.dax.length, max: limits.dax.max }} hint="Begins with EVALUATE or DEFINE. Scalar, Not blank and Between read the first cell.">
                <TextArea id={ids.dax} value={form.dax} disabled={ro} rows={6} className="font-mono text-ui" spellCheck={false} onChange={(e) => set('dax', e.target.value)} invalid={!!errors.dax} />
              </Field>
            )}
          </div>

          <Meter
            test={test}
            verdict={verdict}
            suggestion={ro ? null : suggestion}
            live={mode === 'measure'}
            onTest={runTest}
            onUse={(v) => {
              set('expected', v);
              setErrors((e) => ({ ...e, expected: undefined }));
            }}
          />

          {usesExpected(form.kind) && (
            <Field label="Expected" htmlFor={ids.expected} required error={errors.expected} counter={{ value: form.expected.length, max: limits.expected.max }}>
              <Input id={ids.expected} value={form.expected} disabled={ro} placeholder={KIND_INFO[form.kind].placeholder} className="font-mono" onChange={(e) => set('expected', e.target.value)} invalid={!!errors.expected} />
            </Field>
          )}
          {usesTolerance(form.kind) && (
            <Field label="Tolerance (optional)" htmlFor={ids.tolerance} error={errors.tolerance} hint={`Absolute (0.01) or percent (0.5%). Default ${RUN_RULES.defaultTolerance}.`}>
              <Input id={ids.tolerance} value={form.tolerance} disabled={ro} placeholder="0.5%" className="font-mono" onChange={(e) => set('tolerance', e.target.value)} invalid={!!errors.tolerance} />
            </Field>
          )}
          <Field label="Tags (optional)" htmlFor={ids.tags} error={errors.tags} counter={{ value: form.tags.length, max: limits.tags.max }}>
            <Input id={ids.tags} value={form.tags} disabled={ro} placeholder="sales, finance" onChange={(e) => set('tags', e.target.value)} invalid={!!errors.tags} />
          </Field>
          <Checkbox label="Enabled (included in Run suite)" checked={form.enabled} disabled={ro} onChange={(v) => set('enabled', v)} />
          <InlineError error={saveError} />
        </div>
      </Dialog>
      {onDelete && (
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          title="Delete this case?"
          body={<p className="m-0">“{testCase?.name}” is removed from the suite. Past run results stay in the history.</p>}
          confirmLabel="Delete case"
          danger
          onConfirm={async () => {
            await onDelete();
            onClose();
          }}
        />
      )}
    </>
  );
}

/** The probe's meter: a reading display with the verdict, the row preview, and the two actions. */
function Meter({
  test,
  verdict,
  suggestion,
  live,
  onTest,
  onUse,
}: {
  test: TestState;
  verdict: ReturnType<typeof evaluate> | null;
  suggestion: string | null;
  live: boolean;
  onTest: () => void;
  onUse: (v: string) => void;
}) {
  const r = test.result;
  const failed = r && r.status !== 'success';
  const rows = r && r.status === 'success' ? r.table.rows : [];
  const columns = r && r.status === 'success' ? r.table.columns : [];
  const shown = rows.slice(0, RUN_RULES.maxDisplayRows);
  return (
    <div className="mb-5">
      <div
        className="relative overflow-hidden rounded-xl px-4 py-3.5"
        style={{ background: 'var(--scope-bg)', color: 'var(--scope-ink)' }}
        data-testid={r ? 'test-query-result' : undefined}
        role={failed ? 'alert' : undefined}
        aria-live="polite"
      >
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em]" style={{ color: 'var(--scope-muted)' }}>
          <Gauge className="size-3.5" aria-hidden="true" />
          <span className="flex-1">{test.pending ? 'Measuring…' : r ? (failed ? `Error · ${r.error.category}` : `${rows.length} ${rows.length === 1 ? 'row' : 'rows'} · ${test.ms} ms`) : live ? 'Live reading' : 'Reading'}</span>
          {test.pending && <span className="inline-block size-1.5 animate-pulse rounded-full" style={{ background: 'var(--scope-trace)' }} />}
        </div>
        <div className={cx('mt-1.5 min-h-9 break-all font-mono text-[28px] font-medium leading-9 tracking-[-0.02em] num transition-opacity', test.pending && 'opacity-60')}>
          {!r ? (
            <span style={{ color: 'var(--scope-muted)' }} className="text-base leading-9">
              {live ? 'Type a measure to take a reading' : 'Run Test query to take a reading'}
            </span>
          ) : failed ? (
            <span className="block text-sm leading-5" style={{ color: 'var(--pcb-warn-ink)' }}>
              {r.error.message}
            </span>
          ) : rows.length ? (
            <span data-testid="first-cell">{formatValue(rows[0]?.[0])}</span>
          ) : (
            <span className="text-base" style={{ color: 'var(--scope-muted)' }}>
              No rows
            </span>
          )}
        </div>
        {verdict && !failed && (
          <div className="mt-2 flex items-center gap-2 text-ui">
            <StatusDot tone={verdict.status === 'pass' ? 'ok' : verdict.status === 'fail' ? 'bad' : 'warn'} />
            <span className="font-medium">Would {verdict.status === 'error' ? 'error' : verdict.status}</span>
            <span className="min-w-0 truncate" style={{ color: 'var(--scope-muted)' }}>
              {verdict.message}
            </span>
          </div>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onTest} busy={test.pending}>
          Test query
        </Button>
        {suggestion !== null && (
          <Button size="sm" variant="primary" onClick={() => onUse(suggestion)}>
            Use this value as expected
          </Button>
        )}
        <span className="text-xs text-muted">Nothing is saved until you add the case.</span>
      </div>
      {rows.length > 1 && (
        <div className="mt-3">
          <TableWrap label="Query result preview" maxHeight={220}>
            <table className="x-table is-compact">
              <thead>
                <tr>
                  {columns.map((c, i) => (
                    <th key={i} scope="col">
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((row, i) => (
                  <tr key={i}>
                    {columns.map((_, j) => (
                      <td key={j} className="x-mono">
                        {formatValue(row[j])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {rows.length > shown.length && <p className="m-0 mt-1 text-xs text-muted">First {shown.length} of {rows.length} rows.</p>}
        </div>
      )}
    </div>
  );
}
