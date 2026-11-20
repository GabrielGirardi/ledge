// Reads a reminder time off the end of a task, as people type it in English
// and Portuguese: "Call Ana 15:00", "Call Ana tomorrow at 3pm",
// "Ligar pra Ana 15h", "Amanhã ligar pra Ana às 15h". Imports nothing from
// GNOME Shell, so the unit tests can run it.

const DAY = '(today|hoje|tomorrow|amanhã|amanha)';
const HOURS = '(?:h|hs|hrs)';
const TIME = [
    `(\\d{1,2}):(\\d{2})\\s*(${HOURS}|[ap]\\.?m\\.?)?`, // 15:00, 15:00h, 15:30hrs, 3:30pm
    `(\\d{1,2})${HOURS}(\\d{2})?`, // 15h, 15hs, 15h30
    '(\\d{1,2})\\s*([ap]\\.?m\\.?)', // 3pm, 3 p.m.
].join('|');
const TRAILING = new RegExp(
    `\\s+(?:${DAY}\\s+)?(?:(?:(at|às|as|à)\\s+)|(@)\\s*)?(?:${TIME})(?:\\s+${DAY})?[.!]?$`, 'iu');
const LEADING_DAY = new RegExp(`^${DAY}[:,]?\\s+`, 'iu');
// A weekday or a date right before the time: Ledge only knows today and
// tomorrow, so it leaves these alone rather than remind on the wrong day.
const OTHER_DAY = new RegExp([
    '\\b(?:segunda|terça|terca|quarta|quinta|sexta)(?:-feira)?',
    '\\b(?:sábado|sabado|domingo)',
    '\\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)',
    '\\bdia\\s+\\d{1,2}',
    '\\b\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?',
].map(day => `(?:${day})`).join('|') + '\\s*$', 'iu');

// "Estudar 2h", "Cozinhar 1h30", "John 3:16": without "at", a day, or
// am/pm, an early hour is a duration or a number, not a reminder.
const EARLIEST_BARE_HOUR = 7;
const MINUTE_MS = 60 * 1000;

const isTomorrow = day => /^(tomorrow|amanhã|amanha)$/i.test(day ?? '');
const isToday = day => /^(today|hoje)$/i.test(day ?? '');

/**
 * Splits `text` into the task and when to remind about it: the next time its
 * trailing time comes round, or the day it names (today or tomorrow).
 *
 * @returns {{text: string, at: ?number}} `at` in milliseconds since the epoch
 */
export function parseReminder(text, now = new Date()) {
    const plain = {text: text.trim(), at: null};
    const padded = ` ${text.trim()}`;
    const m = TRAILING.exec(padded);
    let task = m ? padded.slice(0, m.index).trim() : '';
    if (!m || !task || OTHER_DAY.test(task))
        return plain;

    const [, dayBefore, connector, at_, h1, m1, suffix, h2, m2, h3, meridiem3, dayAfter] = m;
    let day = dayBefore ?? dayAfter;
    const leading = LEADING_DAY.exec(task);
    if (leading && !day) {
        day = leading[1];
        task = task.slice(leading[0].length).trim();
        if (!task)
            return plain;
        // "Amanhã ligar pra Ana" reads as "Ligar pra Ana" once the day is gone.
        task = task[0].toLocaleUpperCase() + task.slice(1);
    }
    const meridiem = (/^[ap]/i.test(suffix ?? '') ? suffix : meridiem3)?.[0].toLowerCase();
    let hour = Number(h1 ?? h2 ?? h3);
    const minute = Number(m1 ?? m2 ?? 0);

    if (!connector && !at_ && !day && !meridiem && hour < EARLIEST_BARE_HOUR)
        return plain;
    if (meridiem && (hour < 1 || hour > 12))
        return plain;
    if (meridiem === 'p' && hour < 12)
        hour += 12;
    else if (meridiem === 'a' && hour === 12)
        hour = 0;
    if (hour > 23 || minute > 59)
        return plain;

    const at = new Date(now);
    at.setHours(hour, minute, 0, 0);
    // "Today" at a time gone by is overdue, not tomorrow; so is a time typed
    // within its own minute.
    if (isTomorrow(day) || (!isToday(day) && now - at >= MINUTE_MS))
        at.setDate(at.getDate() + 1);
    return {text: task, at: at.getTime()};
}

/** Calendar days from today to `at`: 0 today, 1 tomorrow, -1 yesterday. */
export function daysFromToday(at, now = new Date()) {
    const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((midnight(new Date(at)) - midnight(now)) / 86400000);
}
