#!/usr/bin/env node
// Creates (or updates in place) the fictional "X10 Retail Demo Model" semantic model in a
// Fabric workspace, then runs a full refresh. Uses only the signed-in Azure CLI identity;
// no tokens or secrets are stored anywhere.
//
//   node tools/demo-model/deploy.mjs <workspaceId> [--out <dir>] [--no-refresh]
//   (or set FABRIC_WORKSPACE_ID instead of passing the workspace id)
//
//   --out <dir>    also write the generated TMDL files to <dir> (for inspection)
//   --no-refresh   skip the Power BI refresh step
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MODEL_NAME, definitionFiles } from './model.mjs';

const FABRIC = 'https://api.fabric.microsoft.com/v1';
const PBI = 'https://api.powerbi.com/v1.0/myorg';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const outDir = option('--out');
const workspaceId = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out') ?? process.env.FABRIC_WORKSPACE_ID;
if (!workspaceId) {
  console.error('usage: node tools/demo-model/deploy.mjs <workspaceId> [--out <dir>] [--no-refresh]  (or set FABRIC_WORKSPACE_ID)');
  process.exit(1);
}

const tokens = {};
function token(resource) {
  tokens[resource] ??= execSync(`az account get-access-token --resource ${resource} --query accessToken -o tsv`, { encoding: 'utf8', shell: true }).trim();
  return tokens[resource];
}
const fabricToken = () => token('https://api.fabric.microsoft.com');
const pbiToken = () => token('https://analysis.windows.net/powerbi/api');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(url, { method = 'GET', body, tok = fabricToken() } = {}) {
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  return { status: r.status, headers: r.headers, json };
}

// Fabric long-running operation: 202 + Location / x-ms-operation-id; poll until done.
async function waitForOperation(res, label) {
  if (res.status !== 202) return res.json;
  const opId = res.headers.get('x-ms-operation-id');
  const location = res.headers.get('location') ?? `${FABRIC}/operations/${opId}`;
  for (;;) {
    await sleep(Math.max(1, Number(res.headers.get('retry-after') ?? 2)) * 1000);
    const op = await call(location);
    const status = op.json?.status;
    process.stdout.write(`  ${label}: ${status}\n`);
    if (status === 'Succeeded') {
      try { return (await call(`${location.replace(/\/$/, '')}/result`)).json; } catch { return undefined; }
    }
    if (status === 'Failed' || status === 'Cancelled') throw new Error(`${label} ${status}: ${JSON.stringify(op.json?.error ?? op.json)}`);
    res = op;
  }
}

function definition() {
  return {
    parts: definitionFiles().map(({ path, content }) => ({
      path,
      payload: Buffer.from(content, 'utf8').toString('base64'),
      payloadType: 'InlineBase64',
    })),
  };
}

async function findModel() {
  const { json } = await call(`${FABRIC}/workspaces/${workspaceId}/semanticModels`);
  return (json?.value ?? []).find((m) => m.displayName === MODEL_NAME);
}

async function refresh(datasetId) {
  const base = `${PBI}/groups/${workspaceId}/datasets/${datasetId}/refreshes`;
  await call(base, { method: 'POST', tok: pbiToken(), body: { type: 'full', commitMode: 'transactional', notifyOption: 'NoNotification' } });
  for (;;) {
    await sleep(3000);
    const { json } = await call(`${base}?$top=1`, { tok: pbiToken() });
    const last = json?.value?.[0];
    process.stdout.write(`  refresh: ${last?.status}${last?.extendedStatus ? ` (${last.extendedStatus})` : ''}\n`);
    if (last?.status === 'Completed') return last;
    if (last?.status === 'Failed' || last?.status === 'Disabled' || last?.status === 'Cancelled') {
      throw new Error(`refresh ${last.status}: ${last.serviceExceptionJson ?? JSON.stringify(last)}`);
    }
  }
}

if (outDir) {
  for (const { path, content } of definitionFiles()) {
    const file = join(outDir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  console.log(`TMDL written to ${outDir}`);
}

let model = await findModel();
if (model) {
  console.log(`Updating definition of existing model ${model.id}`);
  const res = await call(`${FABRIC}/workspaces/${workspaceId}/semanticModels/${model.id}/updateDefinition`, { method: 'POST', body: { definition: definition() } });
  await waitForOperation(res, 'updateDefinition');
} else {
  console.log(`Creating "${MODEL_NAME}" in workspace ${workspaceId}`);
  const res = await call(`${FABRIC}/workspaces/${workspaceId}/semanticModels`, {
    method: 'POST',
    body: { displayName: MODEL_NAME, description: 'Fictional, self-contained retail demo model (no data source).', definition: definition() },
  });
  model = (await waitForOperation(res, 'create')) ?? (await findModel());
  if (!model?.id) model = await findModel();
}
console.log(`Model id: ${model.id}`);

if (!flag('--no-refresh')) {
  await refresh(model.id);
  console.log('Refresh completed.');
}
