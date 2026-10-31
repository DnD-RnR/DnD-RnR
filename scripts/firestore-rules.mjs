import { applicationDefault } from 'firebase-admin/app';
import { readFileSync } from 'node:fs';
const project = process.env.FIREBASE_PROJECT_ID;
if (!project) throw new Error('Missing FIREBASE_PROJECT_ID');
const { access_token } = await applicationDefault().getAccessToken();
const base = `https://firebaserules.googleapis.com/v1/projects/${project}`;
async function request(path, method = 'GET', body) {
  const response = await fetch(base + path, {
    method, headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Rules API ${response.status}: ${result.error?.message || 'Request failed'}`);
  return result;
}
const release = await request('/releases/cloud.firestore');
const current = await request('/rulesets/' + release.rulesetName.split('/').at(-1));
const desired = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
if (current.source.files.length === 1 && current.source.files[0].content === desired) {
  console.log('Server-only Firestore rules already deployed.');
} else {
  const created = await request('/rulesets', 'POST', { source: { files: [{ name: 'firestore.rules', content: desired }] } });
  await request('/releases/cloud.firestore', 'PATCH', { release: { name: `projects/${project}/releases/cloud.firestore`, rulesetName: created.name } });
  console.log('Deployed server-only Firestore rules. Browser access is denied; server access uses IAM.');
}
