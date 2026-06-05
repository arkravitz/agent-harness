const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const SCHEDULE_KINDS = ['daily', 'weekdays', 'hourly', 'every_minutes'];

export function normalizeSchedule(kind, value = {}) {
  if (!SCHEDULE_KINDS.includes(kind)) {
    throw new Error('Schedule kind must be daily, weekdays, hourly, or every_minutes.');
  }
  if (kind === 'daily' || kind === 'weekdays') {
    if (!TIME_PATTERN.test(value.time || '')) {
      throw new Error('Time must use 24-hour HH:MM format.');
    }
    return { time: value.time };
  }
  if (kind === 'hourly') {
    const minute = Number(value.minute);
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
      throw new Error('Minute must be an integer between 0 and 59.');
    }
    return { minute };
  }
  const minutes = Number(value.minutes);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) {
    throw new Error('Interval must be between 5 and 1440 minutes.');
  }
  return { minutes };
}

function atLocalTime(from, time) {
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(from.getFullYear(), from.getMonth(), from.getDate(), hours, minutes, 0, 0);
}

export function computeNextRun(kind, value, from = new Date()) {
  const schedule = normalizeSchedule(kind, value);
  if (kind === 'daily') {
    let candidate = atLocalTime(from, schedule.time);
    if (candidate <= from) {
      candidate = new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate() + 1, candidate.getHours(), candidate.getMinutes(), 0, 0);
    }
    return candidate;
  }
  if (kind === 'weekdays') {
    for (let offset = 0; offset < 8; offset += 1) {
      const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
      const candidate = atLocalTime(day, schedule.time);
      const weekday = day.getDay();
      if (weekday >= 1 && weekday <= 5 && candidate > from) return candidate;
    }
    return atLocalTime(new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7), schedule.time);
  }
  if (kind === 'hourly') {
    const candidate = new Date(from);
    candidate.setMinutes(schedule.minute, 0, 0);
    if (candidate <= from) candidate.setHours(candidate.getHours() + 1);
    return candidate;
  }
  return new Date(from.getTime() + schedule.minutes * 60_000);
}

export function describeSchedule(kind, value) {
  try {
    const schedule = normalizeSchedule(kind, value);
    if (kind === 'daily') return `Every day at ${schedule.time}`;
    if (kind === 'weekdays') return `Every weekday at ${schedule.time}`;
    if (kind === 'hourly') return `Every hour at :${String(schedule.minute).padStart(2, '0')}`;
    return `Every ${schedule.minutes} minutes`;
  } catch {
    return 'Invalid schedule';
  }
}

export class Scheduler {
  constructor({ store, runTask, intervalMs = 20_000, logger = console }) {
    this.store = store;
    this.runTask = runTask;
    this.intervalMs = intervalMs;
    this.logger = logger;
    this.timer = null;
    this.busy = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((error) => this.logger.error(`[scheduler] ${error.message}`));
    }, this.intervalMs);
    this.timer.unref?.();
    this.tick().catch((error) => this.logger.error(`[scheduler] ${error.message}`));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now = new Date()) {
    if (this.busy) return;
    this.busy = true;
    try {
      const due = this.store.dueTasks(now.toISOString());
      for (const task of due) {
        let nextRunAt;
        try {
          nextRunAt = computeNextRun(task.scheduleKind, task.scheduleValue, now).toISOString();
        } catch (error) {
          this.logger.error(`[scheduler] Task "${task.name}" has an invalid schedule: ${error.message}`);
          this.store.setTaskRunTimes(task.id, { nextRunAt: null, lastRunAt: now.toISOString() });
          continue;
        }
        this.store.setTaskRunTimes(task.id, { nextRunAt, lastRunAt: now.toISOString() });
        try {
          await this.runTask(task, { trigger: 'schedule' });
        } catch (error) {
          this.logger.error(`[scheduler] Task "${task.name}" failed: ${error.message}`);
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
