// Unit tests for reminders.js. Run: gjs -m tests/unit/reminders.test.js
import System from 'system';

import {daysFromToday, parseReminder} from '../../extension/ledge@gabrielgirardi.github.io/reminders.js';

let failures = 0;
const check = (name, actual, expected) => {
    const [a, e] = [JSON.stringify(actual), JSON.stringify(expected)];
    if (a !== e) {
        failures++;
        print(`FAIL ${name}: got ${a}, expected ${e}`);
    } else {
        print(`ok   ${name}`);
    }
};

// 20 Nov 2026, 10:30 local time.
const now = new Date(2026, 10, 20, 10, 30);
const at = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
const parse = text => parseReminder(text, now);

check('24-hour clock', parse('Call Ana 15:00'), {text: 'Call Ana', at: at(20, 15)});
check('with "at"', parse('Call Ana at 3pm'), {text: 'Call Ana', at: at(20, 15)});
check('am and minutes', parse('Standup 11:15am'), {text: 'Standup', at: at(20, 11, 15)});
check('12am is midnight', parse('Backup 12am'), {text: 'Backup', at: at(21, 0)});
check('12pm is noon', parse('Lunch 12 p.m.'), {text: 'Lunch', at: at(20, 12)});
check('Portuguese hours and minutes', parse('Dentista 15h30'), {text: 'Dentista', at: at(20, 15, 30)});
check('a time already past is tomorrow', parse('Gym 7:00'), {text: 'Gym', at: at(21, 7)});
check('no time', parse('Buy milk'), {text: 'Buy milk', at: null});
check('a time alone is a task, not a reminder', parse('15:00'), {text: '15:00', at: null});
check('a number inside the text is not a time', parse('Buy 3 apples'), {text: 'Buy 3 apples', at: null});
check('impossible times are text', parse('Read chapter 25:99'), {text: 'Read chapter 25:99', at: null});
check('13pm is text', parse('Odd 13pm'), {text: 'Odd 13pm', at: null});
check('a time glued to a word is text', parse('Ticket A15:00'), {text: 'Ticket A15:00', at: null});

check('"às 15h" is a time', parse('Ligar pra Ana às 15h'), {text: 'Ligar pra Ana', at: at(20, 15)});
check('a bare "2h" is a duration, not 2 AM', parse('Estudar 2h'), {text: 'Estudar 2h', at: null});
check('"for 2h" is a duration', parse('Read for 2h'), {text: 'Read for 2h', at: null});
check('15:00h, as written in Brazil', parse('Reunião 15:00h'), {text: 'Reunião', at: at(20, 15)});
check('tomorrow', parse('Call Ana tomorrow 15:00'), {text: 'Call Ana', at: at(21, 15)});
check('amanhã às', parse('Ligar pra Ana amanhã às 9h'), {text: 'Ligar pra Ana', at: at(21, 9)});
check('tomorrow alone is text', parse('Plan tomorrow'), {text: 'Plan tomorrow', at: null});

check('"15h" alone is a time (the pt_BR hint)', parse('Ligar pra Ana 15h'), {text: 'Ligar pra Ana', at: at(20, 15)});
check('a duration with minutes is not 1:30 AM', parse('Cozinhar 1h30'), {text: 'Cozinhar 1h30', at: null});
check('an early "1:30h" is a duration', parse('Ver filme 1:30h'), {text: 'Ver filme 1:30h', at: null});
check('a verse is not a time', parse('Read John 3:16'), {text: 'Read John 3:16', at: null});
check('an early hour with "at" is a time', parse('Ligar à 1h'), {text: 'Ligar', at: at(21, 1)});
check('an early hour with am is a time', parse('Fly 6am'), {text: 'Fly', at: at(21, 6)});
check('the day after the time', parse('Ligar às 15h amanhã'), {text: 'Ligar', at: at(21, 15)});
check('"hoje" is not left in the task', parse('Ligar hoje às 15h'), {text: 'Ligar', at: at(20, 15)});
check('a full stop at the end', parse('Ligar às 15h.'), {text: 'Ligar', at: at(20, 15)});
check('7am in plain digits is the earliest bare time', parse('Run 7:00'), {text: 'Run', at: at(21, 7)});
check('6:59 in plain digits is a number', parse('Lap 6:59'), {text: 'Lap 6:59', at: null});

check('"amanha" without the accent', parse('Ligar pra Ana amanha 15h'), {text: 'Ligar pra Ana', at: at(21, 15)});
check('"amanha" after the time', parse('Ligar pra Ana 15h amanha'), {text: 'Ligar pra Ana', at: at(21, 15)});
check('the day at the start', parse('Amanhã ligar pra Ana 15h'), {text: 'Ligar pra Ana', at: at(21, 15)});
check('the day at the start, with a colon', parse('Amanhã: ligar pra Ana às 15h'), {text: 'Ligar pra Ana', at: at(21, 15)});
check('tomorrow at the start', parse('Tomorrow call Ana 3pm'), {text: 'Call Ana', at: at(21, 15)});
check('a weekday is left alone', parse('Dentista segunda 10h'), {text: 'Dentista segunda 10h', at: null});
check('segunda-feira às', parse('Dentista segunda-feira às 10h'), {text: 'Dentista segunda-feira às 10h', at: null});
check('a day of the month is left alone', parse('Consulta dia 25 às 10h'), {text: 'Consulta dia 25 às 10h', at: null});
check('an English weekday is left alone', parse('Pay rent on Friday at 9am'), {text: 'Pay rent on Friday at 9am', at: null});
check('today at a time gone by is overdue, not tomorrow', parse('Pagar boleto 10h hoje'), {text: 'Pagar boleto', at: at(20, 10)});
check('typed within its own minute is now, not tomorrow', parseReminder('Call Ana 10:30', new Date(2026, 10, 20, 10, 30, 20)),
    {text: 'Call Ana', at: at(20, 10, 30)});
check('15hs', parse('Reunião 15hs'), {text: 'Reunião', at: at(20, 15)});
check('15:30hrs', parse('Reunião 15:30hrs'), {text: 'Reunião', at: at(20, 15, 30)});
check('@ without a space', parse('Call Ana @3pm'), {text: 'Call Ana', at: at(20, 15)});
check('an exclamation mark', parse('Ligar às 15h!'), {text: 'Ligar', at: at(20, 15)});

check('today', daysFromToday(at(20, 23, 59), now), 0);
check('tomorrow is 1', daysFromToday(at(21, 0, 1), now), 1);
check('yesterday is -1', daysFromToday(at(19, 15), now), -1);

if (failures) {
    print(`${failures} failed`);
    System.exit(1);
}
