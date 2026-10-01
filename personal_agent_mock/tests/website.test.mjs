import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createState, transition, loadCount } from '../public/model.mjs';

const seed = JSON.parse(await readFile(new URL('../fixture.json', import.meta.url), 'utf8'));
const initial = () => createState(structuredClone(seed));
const task = (state, id, project = 'website') => {
  const found = state.projects.find(p => p.id === project)?.tasks.find(t => t.id === id);
  assert.ok(found, `missing ${project}/${id}`);
  return found;
};
const act = (state, type, taskId, extra = {}) => transition(state, { type, project: 'website', task: taskId, ...extra });

test('fixture describes the concrete eight-work website flow and initial design decision', () => {
  const s = initial();
  const p = s.projects.find(x => x.id === 'website');
  assert.ok(p, 'website project must be in the fixture');
  assert.deepEqual(p.tasks.map(t => t.id), ['brief', 'research', 'structure', 'design', 'copy', 'build', 'test', 'release']);
  assert.equal(task(s, 'design').status, 'review');
  assert.equal(task(s, 'design').accepted, false);
  assert.equal(task(s, 'copy').status, 'running');
  assert.equal(task(s, 'build').status, 'waiting');
  assert.deepEqual(task(s, 'build').deps, ['design', 'copy']);
  assert.deepEqual(task(s, 'test').deps, ['build']);
  assert.deepEqual(task(s, 'release').deps, ['test']);
  assert.equal(task(s, 'release').approvalBefore, true);
  assert.equal(s.agents.map(a => a.id).join(','), 'manager,researcher,designer,writer,developer,reviewer');
  assert.equal(seed.version, 3);
});

test('implementation stays blocked until design and copy both receive approval', () => {
  let s = initial();
  s = act(s, 'APPROVE', 'design');
  assert.equal(task(s, 'build').status, 'waiting');
  s = act(s, 'ADVANCE', 'copy');
  assert.equal(task(s, 'copy').status, 'review');
  s = act(s, 'APPROVE', 'copy');
  assert.equal(task(s, 'build').status, 'running');
  assert.equal(task(s, 'build').accepted, false);
});

test('explicit approval is required at review and approval is cleared by returning work', () => {
  let s = initial();
  assert.throws(() => act(s, 'APPROVE', 'copy'), /review|確認|提出/i);
  s = act(s, 'APPROVE', 'design');
  assert.equal(task(s, 'design').accepted, true);
  s = act(s, 'RETURN', 'design');
  assert.equal(task(s, 'design').accepted, false);
  // A free assignee starts the returned work during the release pass.
  assert.equal(task(s, 'design').status, 'running');
  assert.equal(task(s, 'build').status, 'waiting');
});

test('publication rejects unmet prerequisites; paused approvals cannot start dependent work', () => {
  let s = initial();
  assert.throws(() => act(s, 'PUBLISH_DEMO', 'release'), /approval|approved|確認|前提|公開/i);
  s = act(s, 'PAUSE', undefined);
  s = act(s, 'APPROVE', 'design');
  assert.equal(s.projects.find(p => p.id === 'website').status, 'paused');
  assert.equal(task(s, 'build').status, 'waiting');
  assert.throws(() => act(s, 'PUBLISH_DEMO', 'release'), /active|進行|停止|pause|再開/i);
});

test('prelaunch sample permits only the explicit local publication action', () => {
  let s = act(initial(), 'SCENARIO', undefined, { name: 'prelaunch' });
  assert.equal(task(s, 'test').accepted, true);
  assert.equal(task(s, 'release').status, 'approval');
  s = act(s, 'PUBLISH_DEMO', 'release');
  assert.equal(task(s, 'release').status, 'completed');
  assert.equal(task(s, 'release').accepted, true);
  assert.equal(s.projects.find(p => p.id === 'website').scenario, 'prelaunch');
  assert.equal(s.networkCalls ?? 0, 0);
});

test('published scenario exposes a completed, approved release without network side effects', () => {
  const s = act(initial(), 'SCENARIO', undefined, { name: 'published' });
  const release = task(s, 'release');
  assert.equal(release.status, 'completed');
  assert.equal(release.accepted, true);
  assert.equal(s.projects.find(p => p.id === 'website').scenario, 'published');
  assert.equal(s.networkCalls ?? 0, 0);
});

test('agent preference changes affect future starts while running task configuration is a snapshot', () => {
  let s = initial();
  const before = structuredClone(task(s, 'copy').execution);
  s = transition(s, { type: 'CONFIGURE_AGENT', agent: 'writer', provider: 'codex', model: 'custom-ascii-model' });
  assert.deepEqual(task(s, 'copy').execution, before);
  assert.deepEqual(s.agents.find(a => a.id === 'writer').execution,
    { provider: 'codex', model: 'custom-ascii-model' });
  s = act(s, 'FAIL', 'copy');
  s = act(s, 'RETRY', 'copy');
  assert.equal(task(s, 'copy').status, 'running');
  assert.deepEqual(task(s, 'copy').execution,
    { provider: 'codex', model: 'custom-ascii-model' });
});

test('reassignment enforces target agent capacity', () => {
  const s = initial();
  const researcher = s.agents.find(a => a.id === 'researcher');
  // The maintenance project already occupies one researcher slot; fill it to
  // the configured limit in this test setup, then try to add another running task.
  researcher.capacity = loadCount(s, researcher.id);
  assert.ok(researcher.capacity > 0);
  assert.throws(() => act(s, 'REASSIGN', 'copy', { agent: researcher.id }), /capacity|limit|上限|空き/i);
});

test('delegation is bounded to one child task per project', () => {
  let s = initial();
  s = act(s, 'DELEGATE', 'copy');
  const count = s.projects.find(p => p.id === 'website').tasks.filter(t => t.parent).length;
  assert.equal(count, 1);
  s = act(s, 'DELEGATE', 'copy');
  assert.equal(s.projects.find(p => p.id === 'website').tasks.filter(t => t.parent).length, 1);
  assert.throws(() => act(s, 'DELEGATE', 'design'), /1件|1 task|追加できる/i);
});

test('cancelled project rejects further publication and task advancement', () => {
  let s = act(initial(), 'CANCEL', undefined);
  assert.equal(s.projects.find(p => p.id === 'website').status, 'cancelled');
  assert.throws(() => act(s, 'ADVANCE', 'copy'), /active|進行|再開|cancel/i);
  assert.throws(() => act(s, 'PUBLISH_DEMO', 'release'), /active|進行|再開|cancel/i);
});

test('scoped memory and schedules persist in the returned state', () => {
  let s = transition(initial(), { type: 'MEMORY', project: 'website', scope: 'project', text: 'Use concise product language.' });
  assert.match(s.projects.find(p => p.id === 'website').memory, /concise product language/);
  s = transition(s, { type: 'SCHEDULE', id: 'design-review', day: '2000-01-20', time: '10:30', repeat: 'weekly', enabled: true });
  const schedule = s.schedules.find(x => x.id === 'design-review');
  assert.deepEqual([schedule.day, schedule.time, schedule.repeat, schedule.enabled], ['2000-01-20', '10:30', 'weekly', true]);
  const reloaded = createState(JSON.parse(JSON.stringify(s)));
  assert.equal(reloaded.schedules.find(x => x.id === 'design-review').repeat, 'weekly');
});
