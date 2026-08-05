import assert from 'node:assert/strict';
import test from 'node:test';
import { computeNextRun, describeSchedule, normalizeSchedule } from '../server/scheduler.mjs';

test('daily schedules move to tomorrow after the time has passed', () => {
  const from = new Date(2026, 9, 21, 8, 0, 0);
  const next = computeNextRun('daily', { time: '07:30' }, from);
  assert.equal(next.getFullYear(), 2026);
  assert.equal(next.getMonth(), 9);
  assert.equal(next.getDate(), 22);
  assert.equal(next.getHours(), 7);
  assert.equal(next.getMinutes(), 30);
});

test('daily schedules stay today when the time is still ahead', () => {
  const from = new Date(2026, 9, 21, 6, 0, 0);
  const next = computeNextRun('daily', { time: '07:30' }, from);
  assert.equal(next.getDate(), 21);
  assert.equal(next.getHours(), 7);
});

test('weekday schedules skip the weekend', () => {
  const friday = new Date(2026, 9, 23, 8, 0, 0);
  assert.equal(friday.getDay(), 5);
  const next = computeNextRun('weekdays', { time: '07:30' }, friday);
  assert.equal(next.getDay(), 1);
  assert.equal(next.getDate(), 26);
  assert.equal(next.getHours(), 7);
  assert.equal(next.getMinutes(), 30);
});

test('hourly schedules advance to the next matching minute', () => {
  const from = new Date(2026, 9, 21, 10, 15, 0);
  const next = computeNextRun('hourly', { minute: 0 }, from);
  assert.equal(next.getHours(), 11);
  assert.equal(next.getMinutes(), 0);
});

test('interval schedules add the configured number of minutes', () => {
  const from = new Date(2026, 9, 21, 10, 15, 0);
  const next = computeNextRun('every_minutes', { minutes: 30 }, from);
  assert.equal(next.getHours(), 10);
  assert.equal(next.getMinutes(), 45);
});

test('schedule validation rejects malformed values', () => {
  assert.throws(() => normalizeSchedule('daily', { time: '25:00' }), /HH:MM/);
  assert.throws(() => normalizeSchedule('hourly', { minute: 61 }), /Minute/);
  assert.throws(() => normalizeSchedule('every_minutes', { minutes: 2 }), /between 5/);
  assert.throws(() => normalizeSchedule('monthly', {}), /Schedule kind/);
});

test('schedule descriptions are human readable', () => {
  assert.equal(describeSchedule('daily', { time: '07:30' }), 'Every day at 07:30');
  assert.equal(describeSchedule('weekdays', { time: '07:30' }), 'Every weekday at 07:30');
  assert.equal(describeSchedule('hourly', { minute: 5 }), 'Every hour at :05');
  assert.equal(describeSchedule('every_minutes', { minutes: 60 }), 'Every 60 minutes');
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Scheduler } from '../server/scheduler.mjs';
import { Store } from '../server/store.mjs';

test('scheduler runs due tasks and advances their next run', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-scheduler-'));
  const store = new Store(dir, { seed: false });
  try {
    const task = store.createTask({
      name: 'Due task',
      prompt: 'Run.',
      scheduleKind: 'every_minutes',
      scheduleValue: { minutes: 60 },
      nextRunAt: new Date(Date.now() - 60_000).toISOString()
    });
    let calls = 0;
    const scheduler = new Scheduler({
      store,
      runTask: async () => {
        calls += 1;
      },
      logger: { error() {} }
    });
    await scheduler.tick(new Date());
    assert.equal(calls, 1);
    const updated = store.getTask(task.id);
    assert.ok(new Date(updated.nextRunAt).getTime() > Date.now());
    assert.ok(updated.lastRunAt);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scheduler ignores disabled tasks', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-scheduler-'));
  const store = new Store(dir, { seed: false });
  try {
    store.createTask({
      name: 'Paused task',
      prompt: 'Do not run.',
      scheduleKind: 'every_minutes',
      scheduleValue: { minutes: 60 },
      enabled: false,
      nextRunAt: new Date(Date.now() - 60_000).toISOString()
    });
    let calls = 0;
    const scheduler = new Scheduler({
      store,
      runTask: async () => {
        calls += 1;
      },
      logger: { error() {} }
    });
    await scheduler.tick(new Date());
    assert.equal(calls, 0);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
