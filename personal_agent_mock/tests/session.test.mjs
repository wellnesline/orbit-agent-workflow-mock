import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createState, sessionKey, transition } from '../public/model.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixture.json', import.meta.url), 'utf8'));
const fresh = () => createState(fixture);
const act = (state, type, fields = {}) => transition(state, { type, ...fields });
const session = (state, project, task) => state.sessions[sessionKey(project, task)];

test('every process has a stable, project-scoped session, separate even for the same agent', () => {
  const s = fresh();
  assert.equal(sessionKey('a:b', 'c'), 'session:a%3Ab:c');
  assert.equal(sessionKey('a', 'b:c'), 'session:a:b%3Ac');

  const tasks = s.projects.flatMap(p => p.tasks.map(t => ({ project: p.id, task: t })));
  const sameAgent = tasks.find(x => tasks.some(y => y.project === x.project && y.task.id !== x.task.id && y.task.agent === x.task.agent));
  assert.ok(sameAgent, 'fixture should contain multiple jobs owned by one agent');
  const otherSameAgentTask = tasks.find(x => x.project === sameAgent.project && x.task.id !== sameAgent.task.id && x.task.agent === sameAgent.task.agent);
  assert.notEqual(sessionKey(sameAgent.project, sameAgent.task.id), sessionKey(otherSameAgentTask.project, otherSameAgentTask.task.id));
  assert.notEqual(sessionKey(sameAgent.project, sameAgent.task.id), sessionKey(tasks.find(x => x.project !== sameAgent.project).project, sameAgent.task.id));
  assert.equal(session(s, sameAgent.project, sameAgent.task.id).id, sessionKey(sameAgent.project, sameAgent.task.id));

  const serialized = JSON.parse(JSON.stringify(s));
  const reloaded = createState(serialized);
  assert.deepEqual(session(reloaded, sameAgent.project, sameAgent.task.id), session(s, sameAgent.project, sameAgent.task.id));
});

test('sending a message changes only its session and rejects empty text', () => {
  const s = fresh();
  const p = s.projects.find(x => x.id === 'website');
  const target = p.tasks[0];
  const beforeTarget = structuredClone(session(s, p.id, target.id));
  const other = p.tasks.find(x => x.id !== target.id);
  const beforeOther = structuredClone(session(s, p.id, other.id));
  const sent = act(s, 'SESSION_SEND', { project: p.id, task: target.id, text: 'この仕事の条件を確認してください' });
  assert.deepEqual(session(sent, p.id, other.id), beforeOther);
  assert.deepEqual(session(s, p.id, target.id), beforeTarget);
  assert.equal(session(sent, p.id, target.id).messages.at(-2).text, 'この仕事の条件を確認してください');
  assert.equal(session(sent, p.id, target.id).messages.at(-2).role, 'you');
  assert.equal(session(sent, p.id, target.id).messages.at(-1).role, 'agent');
  assert.match(session(sent, p.id, target.id).messages.at(-1).text, /実AIは未接続/);
  assert.throws(() => act(s, 'SESSION_SEND', { project: p.id, task: target.id, text: '  \n ' }), /メッセージ/);
});

test('new work gets an independent session and legacy task messages migrate once', () => {
  const legacy = fresh();
  const p = legacy.projects.find(x => x.id === 'website');
  const task = p.tasks[0];
  const key = sessionKey(p.id, task.id);
  delete legacy.sessions[key];
  legacy.messages.push(
    { project: p.id, task: task.id, role: 'you', text: '旧メッセージ1' },
    { project: p.id, task: task.id, role: 'agent', text: '旧メッセージ2' },
  );
  p.conversation.push({ task: task.id, role: 'you', text: '旧会話' });
  const migrated = createState(legacy);
  assert.equal(session(migrated, p.id, task.id).messages.filter(m => m.text === '旧メッセージ1').length, 1);
  assert.equal(session(migrated, p.id, task.id).messages.filter(m => m.text === '旧メッセージ2').length, 1);
  assert.equal(session(migrated, p.id, task.id).messages.filter(m => m.text === '旧会話').length, 1);
  assert.deepEqual(createState(migrated), migrated, 'reloading migrated state must not duplicate legacy messages');

  const added = act(migrated, 'ADD_TASK', { project: p.id, label: '新しい仕事', result: '新しい成果物', agent: task.agent, deps: [] });
  const newTask = added.projects.find(x => x.id === p.id).tasks.find(x => x.label === '新しい仕事');
  assert.ok(newTask);
  const newSession = session(added, p.id, newTask.id);
  assert.ok(newSession, 'newly created work should immediately receive a session');
  assert.equal(newSession.messages.length, 2, 'new session starts with its own context and sample response');
  assert.notEqual(newSession.id, sessionKey(p.id, task.id));
});
