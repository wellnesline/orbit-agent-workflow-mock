import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createState, transition, loadCount } from '../public/model.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixture.json', import.meta.url), 'utf8'));
const fresh = (edit = () => {}) => {
  const seed = structuredClone(fixture);
  edit(seed);
  return createState(seed);
};
const act = (state, type, fields = {}) => transition(state, { type, ...fields });
const project = (state, id) => state.projects.find(p => p.id === id);
const member = (state, projectId, agentId) => project(state, projectId).members.find(m => m.agent === agentId);
const task = (state, projectId, taskId) => project(state, projectId).tasks.find(t => t.id === taskId);

test('each fixture project carries its own member placement and phase list', () => {
  const s = fresh();
  for (const p of s.projects) {
    assert.ok(Array.isArray(p.members), `${p.id} needs a members array`);
    assert.ok(Array.isArray(p.phases), `${p.id} needs a phases array`);
    for (const placement of p.members) {
      assert.deepEqual(Object.keys(placement).sort(), ['agent', 'brief', 'role']);
      assert.ok(s.agents.some(a => a.id === placement.agent), `${p.id} placement references a global agent`);
    }
  }
  assert.notDeepEqual(project(s, 'website').phases, project(s, 'research').phases);
});

test('createState gives each existing project independent member briefs and phase labels', () => {
  const s = fresh(seed => {
    seed.projects[0].members = [{ agent: 'manager', role: 'producer', brief: 'Website only' }];
    seed.projects[0].phases = ['Plan', 'Build'];
    seed.projects[1].members = [{ agent: 'manager', role: 'reviewer', brief: 'Monthly updates only' }];
    seed.projects[1].phases = ['Inspect', 'Update'];
  });
  assert.deepEqual(member(s, 'website', 'manager'), { agent: 'manager', role: 'producer', brief: 'Website only' });
  assert.deepEqual(member(s, 'maintenance', 'manager'), { agent: 'manager', role: 'reviewer', brief: 'Monthly updates only' });
  assert.deepEqual(project(s, 'website').phases, ['Plan', 'Build']);
  assert.deepEqual(project(s, 'maintenance').phases, ['Inspect', 'Update']);
});

test('CREATE_AGENT adds a global provider configuration without assigning it to projects', () => {
  let s = act(fresh(), 'CREATE_AGENT', { name: 'Shared analyst', role: 'Research', provider: 'codex' });
  const agent = s.agents.find(a => a.name === 'Shared analyst');
  assert.ok(agent);
  assert.equal(agent.role, 'Research');
  assert.equal(agent.capacity, 2);
  assert.deepEqual(agent.execution, { provider: 'codex', model: 'default' });
  assert.ok(s.projects.every(p => !p.members.some(m => m.agent === agent.id)));
  assert.throws(() => act(s, 'CREATE_AGENT', { name: 'No provider', role: 'Research', provider: 'unknown' }), /AI|provider|選んで/i);
});

test('CREATE_PROJECT starts empty with project-local members and phases', () => {
  const s = act(fresh(), 'CREATE_PROJECT', { name: 'New project', goal: 'A separate goal' });
  const created = s.projects.at(-1);
  assert.equal(created.name, 'New project');
  assert.deepEqual(created.tasks, []);
  assert.deepEqual(created.members, []);
  assert.deepEqual(created.phases, []);
});

test('PLACE_AGENT updates one project roster and keeps the same agent independent elsewhere', () => {
  let s = act(fresh(), 'CREATE_AGENT', { name: 'Shared analyst', role: 'Research', provider: 'claude' });
  const agent = s.agents.find(a => a.name === 'Shared analyst');
  s = act(s, 'PLACE_AGENT', { project: 'website', agent: agent.id, role: 'Market research', brief: 'Study website customers' });
  s = act(s, 'PLACE_AGENT', { project: 'maintenance', agent: agent.id, role: 'Change review', brief: 'Check monthly edits' });
  s = act(s, 'PLACE_AGENT', { project: 'website', agent: agent.id, role: 'Research lead', brief: 'Updated project brief' });
  assert.equal(project(s, 'website').members.filter(m => m.agent === agent.id).length, 1);
  assert.deepEqual(member(s, 'website', agent.id), { agent: agent.id, role: 'Research lead', brief: 'Updated project brief' });
  assert.deepEqual(member(s, 'maintenance', agent.id), { agent: agent.id, role: 'Change review', brief: 'Check monthly edits' });
  assert.throws(() => act(s, 'PLACE_AGENT', { project: 'website', agent: 'missing-agent', role: 'Research', brief: 'No such global agent' }), /担当|agent|AI|見つかりません/i);
});

test('ADD_TASK uses project membership, validates dependencies, and derives a new phase', () => {
  let s = fresh(seed => {
    seed.projects[0].members = [{ agent: 'manager', role: 'lead', brief: 'Website work' }];
    seed.projects[0].phases = ['Plan', 'Build', 'Review'];
  });
  s = act(s, 'ADD_TASK', { project: 'website', label: 'Follow-up', result: 'Follow-up notes', agent: 'manager', deps: ['design'] });
  const added = project(s, 'website').tasks.at(-1);
  assert.ok(added.id);
  assert.equal(project(s, 'website').tasks.filter(t => t.id === added.id).length, 1);
  assert.equal(added.phase, 3);
  assert.deepEqual(added.deps, ['design']);
  assert.equal(added.status, 'waiting');
  assert.throws(() => act(s, 'ADD_TASK', { project: 'website', label: 'Bad owner', result: 'Result', agent: 'researcher', deps: [] }), /配置|担当|member|配置され/i);
  assert.throws(() => act(s, 'ADD_TASK', { project: 'website', label: 'Bad dependency', result: 'Result', agent: 'manager', deps: ['missing'] }), /仕事|前提|依存|dependency|見つかりません/i);
  assert.throws(() => act(s, 'ADD_TASK', { project: 'website', label: '', result: 'Result', agent: 'manager', deps: [] }), /必須|入力|label/i);
});

test('shared agent capacity is counted across projects and release starts waiting work when a slot opens', () => {
  let s = fresh(seed => {
    seed.agents.find(a => a.id === 'manager').capacity = 1;
    seed.projects[0].members = [{ agent: 'manager', role: 'lead', brief: 'Project A' }];
    seed.projects[1].members = [{ agent: 'manager', role: 'lead', brief: 'Project B' }];
  });
  s = act(s, 'ADD_TASK', { project: 'website', label: 'First', result: 'First result', agent: 'manager', deps: [] });
  s = act(s, 'ADD_TASK', { project: 'maintenance', label: 'Second', result: 'Second result', agent: 'manager', deps: [] });
  const first = project(s, 'website').tasks.find(t => t.label === 'First');
  const second = project(s, 'maintenance').tasks.find(t => t.label === 'Second');
  assert.equal(first.status, 'running');
  assert.equal(second.status, 'waiting');
  assert.equal(loadCount(s, 'manager'), 1);
  s = act(s, 'ADVANCE', { project: 'website', task: first.id });
  assert.equal(task(s, 'maintenance', second.id).status, 'running');
  assert.equal(loadCount(s, 'manager'), 1);
});

test('REASSIGN requires the recipient to be placed in that project', () => {
  const s = fresh(seed => {
    seed.projects[0].members = [{ agent: 'researcher', role: 'researcher', brief: 'Website research' }];
  });
  assert.throws(() => act(s, 'REASSIGN', { project: 'website', task: 'copy', agent: 'writer' }), /配置|担当|member|参加/i);
  const moved = act(s, 'REASSIGN', { project: 'website', task: 'copy', agent: 'researcher' });
  assert.equal(task(moved, 'website', 'copy').agent, 'researcher');
  assert.equal(task(s, 'website', 'copy').agent, 'writer');
});

test('project-specific task and chat records stay isolated while a global agent is reused', () => {
  let s = fresh(seed => {
    seed.projects[0].members = [{ agent: 'manager', role: 'lead', brief: 'Website-specific context' }];
    seed.projects[1].members = [{ agent: 'manager', role: 'lead', brief: 'Maintenance-specific context' }];
  });
  s = act(s, 'ADD_TASK', { project: 'website', label: 'Website research', result: 'Website result', agent: 'manager', deps: [] });
  s = act(s, 'ADD_TASK', { project: 'maintenance', label: 'Monthly research', result: 'Monthly result', agent: 'manager', deps: [] });
  const websiteTask = project(s, 'website').tasks.find(t => t.label === 'Website research');
  const maintenanceTask = project(s, 'maintenance').tasks.find(t => t.label === 'Monthly research');
  s = act(s, 'ASK', { project: 'website', task: websiteTask.id, text: 'What remains?' });
  assert.ok(s.messages.every(m => m.project === 'website'));
  assert.equal(task(s, 'maintenance', maintenanceTask.id).result, 'Monthly result');
  assert.equal(member(s, 'website', 'manager').brief, 'Website-specific context');
  assert.equal(member(s, 'maintenance', 'manager').brief, 'Maintenance-specific context');
});

test('changing global agent defaults affects subsequent starts while running execution stays a snapshot', () => {
  let s = fresh(seed => {
    seed.projects[0].members = [{ agent: 'manager', role: 'lead', brief: 'Website' }];
    seed.projects[1].members = [{ agent: 'manager', role: 'lead', brief: 'Maintenance' }];
  });
  const runningExecution = structuredClone(task(s, 'website', 'copy').execution);
  s = act(s, 'CONFIGURE_AGENT', { agent: 'manager', provider: 'codex', model: 'next-model' });
  s = act(s, 'ADD_TASK', { project: 'maintenance', label: 'Next run', result: 'Next result', agent: 'manager', deps: [] });
  const nextTask = project(s, 'maintenance').tasks.find(t => t.label === 'Next run');
  assert.deepEqual(task(s, 'website', 'copy').execution, runningExecution);
  assert.deepEqual(task(s, 'maintenance', nextTask.id).execution, { provider: 'codex', model: 'next-model' });
});

test('SCENARIO cannot replace a website sample after a project-specific task is added', () => {
  let s = fresh();
  const website = project(s, 'website');
  const assignedAgent = website.members[0].agent;
  s = act(s, 'ADD_TASK', {
    project: 'website', label: '追加確認', result: '追加確認メモ', agent: assignedAgent, deps: [],
  });
  const added = project(s, 'website').tasks.find(t => t.label === '追加確認');
  assert.ok(added, 'added task must exist before attempting a sample switch');

  for (const name of ['design', 'prelaunch', 'published']) {
    const stateBefore = structuredClone(s);
    const action = { type: 'SCENARIO', project: 'website', name };
    const actionBefore = structuredClone(action);
    assert.throws(
      () => transition(s, action),
      { message: '追加した仕事があるため、サンプルの状態を切り替えられません' },
    );
    assert.deepEqual(s, stateBefore, `rejected ${name} switch must not mutate the input state`);
    assert.deepEqual(action, actionBefore, `rejected ${name} switch must not mutate the API action`);
    assert.ok(project(s, 'website').tasks.some(t => t.id === added.id), `added task must survive rejected ${name} switch`);
  }
});

test('SCENARIO switching remains available when a project contains only its sample tasks', () => {
  const s = fresh();
  const action = { type: 'SCENARIO', project: 'website', name: 'prelaunch' };
  const stateBefore = structuredClone(s);
  const actionBefore = structuredClone(action);
  const switched = transition(s, action);
  assert.equal(project(switched, 'website').scenario, 'prelaunch');
  assert.equal(task(switched, 'website', 'release').status, 'approval');
  assert.deepEqual(s, stateBefore, 'a successful scenario switch must leave the input state unchanged');
  assert.deepEqual(action, actionBefore, 'a successful scenario switch must leave the API action unchanged');
});
