import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createState, transition } from '../public/model.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixture.json', import.meta.url), 'utf8'));
const fresh = () => createState(fixture);
const act = (state, type, fields = {}) => transition(state, { type, ...fields });
const project = (state, id = 'website') => state.projects.find(p => p.id === id);
const emptyProject = () => ({
  id: 'conversation-empty', name: '会話から始める', goal: '目的を相談しながら決める',
  due: '', status: 'active', version: 1, memory: '', members: [], phases: [], tasks: [], conversation: [],
});

test('free-form chat is saved per project and does not invent a proposal', () => {
  const s = fresh();
  s.projects.push(emptyProject());
  const next = act(s, 'PROCESS_CHAT', { project: 'conversation-empty', text: 'この企画の方向性を一緒に考えたい' });

  assert.equal(project(next, 'conversation-empty').conversation[0].text, 'この企画の方向性を一緒に考えたい');
  assert.match(project(next, 'conversation-empty').conversation[1].text, /実AI未接続/);
  assert.equal(project(next, 'conversation-empty').proposal, undefined);
  assert.deepEqual(project(next).conversation, []);
  assert.deepEqual(project(next).tasks, project(s).tasks);
  const ordinaryQuestion = act(next, 'PROCESS_CHAT', {
    project: 'conversation-empty',
    text: '進め方について相談したいのですが、どの案がおすすめですか？',
  });
  assert.equal(project(ordinaryQuestion, 'conversation-empty').proposal, undefined);
  assert.equal(project(ordinaryQuestion, 'conversation-empty').tasks.length, 0);
  const existingQuestion = act(s, 'PROCESS_CHAT', { text: '追加料金のことを教えてください' });
  assert.equal(project(existingQuestion).proposal, undefined);
  assert.equal(project(existingQuestion).tasks.length, project(s).tasks.length);
  assert.throws(() => act(s, 'PROCESS_CHAT', { project: 'conversation-empty', text: 'この仕事について', task: 'missing-context' }), /仕事が見つかりません/);
  const contextual = act(s, 'PROCESS_CHAT', { text: 'この仕事を相談したい', task: 'brief' });
  assert.equal(project(contextual).conversation[0].task, 'brief');
  assert.match(project(contextual).conversation[1].text, /仕事についての相談として保存/);

  let long = s;
  for (let i = 0; i < 42; i++) {
    long = act(long, 'PROCESS_CHAT', { project: 'conversation-empty', text: `自由文 ${i}` });
  }
  const history = project(long, 'conversation-empty').conversation;
  assert.equal(history.length, 40);
  assert.equal(history[0].text, '自由文 22');
});

test('supported proposals preview without changing tasks, then apply only against their base snapshot', () => {
  let s = fresh();
  s.projects.push(emptyProject());
  const before = project(s, 'conversation-empty');
  const planned = act(s, 'PROCESS_CHAT', { project: before.id, text: 'このゴールまでの進め方を一緒に考えて' });
  const preview = project(planned, before.id);
  assert.equal(preview.tasks.length, 0);
  assert.equal(preview.proposal.tasks.length, 3);
  assert.equal(preview.proposal.tasks[0].proposed, true);
  assert.deepEqual(preview.phases, []);

  const applied = act(planned, 'APPLY_PROCESS_PROPOSAL', { project: before.id });
  const result = project(applied, before.id);
  assert.equal(result.tasks.length, 3);
  assert.ok(result.tasks.every(t => !t.proposed));
  assert.deepEqual(result.tasks[1].deps, [result.tasks[0].id]);
  assert.equal(result.proposal, undefined);

  const stale = act(s, 'PROCESS_CHAT', { project: before.id, text: 'このゴールまでの進め方を一緒に考えて' });
  project(stale, before.id).tasks.push({ id: 'concurrent-change', accepted: false, deps: [] });
  assert.throws(() => act(stale, 'APPLY_PROCESS_PROPOSAL', { project: before.id }), /状態が変わりました/);
});

test('existing-work proposal is discardable and pause or cancel never creates one', () => {
  let s = fresh();
  const original = structuredClone(project(s));
  const proposed = act(s, 'PROCESS_CHAT', { text: '追加の調査を並行して進めたい' });
  const preview = project(proposed);
  assert.equal(preview.tasks.length, original.tasks.length);
  assert.equal(preview.proposal.tasks.length, original.tasks.length + 1);
  assert.equal(preview.proposal.tasks.at(-1).proposed, true);
  const discarded = act(proposed, 'DISCARD_PROCESS_PROPOSAL');
  assert.equal(project(discarded).proposal, undefined);
  assert.deepEqual(project(discarded).tasks, original.tasks);
  assert.deepEqual(project(discarded).phases, original.phases);

  for (const stopped of [act(s, 'PAUSE'), act(s, 'CANCEL')]) {
    const chatted = act(stopped, 'PROCESS_CHAT', { text: '進め方案' });
    assert.equal(project(chatted).proposal, undefined);
    assert.equal(project(chatted).conversation[0].text, '進め方案');
  }
});
