import { MODEL_LABEL, RUN_RULES } from '../config';
import { KIND_INFO } from '../domain/compare';
import { formatMs } from '../domain/runs';
import { KIND_COLOR, KIND_SHAPE } from '../bench/lenses';
import { CASE_KINDS, limits, type CaseKind } from '../model';

const KIND_RULE: Record<CaseKind, string> = {
  scalar: `The first cell of the first row equals Expected. Numbers compare within the tolerance: absolute (0.01) or a percent of Expected (0.5%); default ${RUN_RULES.defaultTolerance}. Anything else compares as exact text.`,
  rowcount: 'The number of rows returned equals Expected (a whole number). Zero rows is a valid count.',
  notblank: 'The first cell is not blank, null or an empty string.',
  between: 'The first cell is a number within low..high, both ends included.',
};

function KindMark({ kind }: { kind: CaseKind }) {
  const shape = KIND_SHAPE[kind];
  const fill = KIND_COLOR[kind];
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden="true">
      {shape === 'dot' && <circle cx={12} cy={12} r={6} fill={fill} />}
      {shape === 'line' && <rect x={3} y={7} width={18} height={10} rx={5} fill={fill} />}
      {shape === 'square' && <rect x={6} y={6} width={12} height={12} rx={2.5} fill={fill} />}
      {shape === 'diamond' && <path d="M12 4l8 8-8 8-8-8z" fill={fill} />}
    </svg>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-x-10 gap-y-2 border-t border-line py-7 md:grid-cols-[200px_minmax(0,1fr)]">
      <h2 className="m-0 text-sm font-semibold">{title}</h2>
      <div className="min-w-0 text-sm leading-6">{children}</div>
    </section>
  );
}

/** About: what the app is for, the metaphor, the comparison rules and limits from config.ts. */
export function AboutPage() {
  return (
    <div className="max-w-[880px]">
      <h1 className="m-0 text-2xl font-semibold md:text-3xl">Regression tests for DAX measures</h1>
      <p className="m-0 mt-3 max-w-[62ch] text-base text-muted">
        Save the values your key measures should return, run them against {MODEL_LABEL} after every model change, and see
        what still holds, what moved and by how much.
      </p>

      <div className="mt-10">
        <Block title="The bench">
          <p className="m-0">
            Each suite is a circuit board. Each measure (or table) a case queries is a chip, and each case is a probe
            soldered to it. Running a suite sends current from the model connector along the traces; probes light green
            when the reading passes, red when it fails (with the gap), amber when the query errors. Disabled cases are
            unpowered.
          </p>
          <p className="m-0 mt-3 text-muted">
            Lenses repaint the same probes by status, duration, flakiness (pass and fail flips across runs) and kind.
            The Oscilloscope traces every case across runs; Short circuit explains each error; the Probe adds a case with
            a live reading. The list view shows the same data as a table.
          </p>
        </Block>
        <Block title="Kinds of probe">
          <dl className="m-0 grid gap-4">
            {CASE_KINDS.map((k) => (
              <div key={k} className="flex gap-3">
                <KindMark kind={k} />
                <div>
                  <dt className="font-medium">{KIND_INFO[k].label}</dt>
                  <dd className="m-0 text-muted">{KIND_RULE[k]}</dd>
                </div>
              </div>
            ))}
          </dl>
          <p className="m-0 mt-4 text-muted">
            Thousands separators, currency symbols and codes are stripped before comparing (“$34,054.70” reads as
            34054.7), “(120)” reads as −120 and “45%” as 0.45. A query that returns no rows is an error for every kind
            except Row count.
          </p>
        </Block>
        <Block title="Run rules">
          <ul className="m-0 grid gap-1.5 pl-5">
            <li>Run suite runs every enabled case, {RUN_RULES.concurrency} at a time.</li>
            <li>Each case times out after {formatMs(RUN_RULES.timeoutMs)} and is recorded as an error.</li>
            <li>Cancel stops the queued cases; cases already running finish and are recorded.</li>
            <li>A connector failure is recorded as an error with its category and message, never a crash.</li>
            <li>Raw DAX must begin with EVALUATE or DEFINE (leading comments are allowed).</li>
            <li>
              Previews show at most {RUN_RULES.maxDisplayRows} rows. Queries are capped at{' '}
              <span className="font-mono num">{RUN_RULES.queryRowLimit.toLocaleString()}</span> rows (
              <span className="font-mono num">{RUN_RULES.rowcountRowLimit.toLocaleString()}</span> for Row count); above the cap the case errors with “overflow”.
            </li>
            <li>The Oscilloscope shows the last {RUN_RULES.historyRuns} runs. Two people can run the same suite at once; each run is its own record.</li>
          </ul>
        </Block>
        <Block title="Who can do what">
          <p className="m-0">
            Everyone who can open the app sees every suite, case and run, can create suites and can run any suite. Only a
            suite’s owner (or an admin) edits the suite or its cases. Runs and results are history and are not edited
            afterwards. Queries run as the signed-in person through the Fabric semantic model connector, so each person
            sees what their own permissions on the model allow. Only the values a case returns (up to {limits.actual.max}{' '}
            characters) are saved with a result.
          </p>
        </Block>
        <Block title="Built with">
          <p className="m-0 text-muted">Microsoft Fabric Apps, a Fabric SQL database and the semantic model connector. Built by Datachain Consulting for AI @Work.</p>
        </Block>
      </div>
    </div>
  );
}
