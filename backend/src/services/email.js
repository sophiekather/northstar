const { Resend } = require('resend');

const FROM = 'reminders@civicnorthconsulting.com';
const APP_URL = () => process.env.FRONTEND_URL || 'https://northstar-eta-ten.vercel.app';

function getResend() {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
  return new Resend(process.env.RESEND_API_KEY);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// Due dates are stored as UTC midnight, so they must be read as calendar dates.
// Converting the instant into Pacific renders the previous day (Jul 9 → Jul 8),
// which is the same trap fmtDate avoids on the frontend.
function dueDateStr(date) {
  return date.toISOString().slice(0, 10);
}

/** "Jul 21" from a UTC-midnight due date. */
function fmtDue(date) {
  const [y, m, d] = dueDateStr(date).split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Assigned-task table for the daily digest. Overdue rows are red, everything
 * else olive — the same colour language the task board uses.
 * `today` is a YYYY-MM-DD Pacific calendar date; due today is not overdue.
 */
function taskSection(tasks, today) {
  if (tasks.length === 0) {
    return `<p style="font-size: 15px; color: #7a7a8a; margin: 0 0 24px;">Nothing open assigned to you right now. 🎉</p>`;
  }

  const rows = tasks.map((t) => {
    const overdue = t.dueDate && dueDateStr(t.dueDate) < today;
    const due = t.dueDate
      ? `<span style="color: ${overdue ? '#c0392b' : '#87a93e'}; font-weight: 700;">${overdue ? 'Overdue · ' : 'Due '}${fmtDue(t.dueDate)}</span>`
      : `<span style="color: #aaa;">No due date</span>`;
    const client = t.project?.client?.name ? escapeHtml(t.project.client.name) : '';
    const project = t.project?.name ? escapeHtml(t.project.name) : '';
    return `
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid #efeaf5;">
          <div style="font-size: 15px; font-weight: 600; color: #3b1259;">${escapeHtml(t.title)}</div>
          <div style="font-size: 13px; font-weight: 700; color: #87a93e; margin-top: 2px;">${client}${client && project ? ' · ' : ''}${project}</div>
        </td>
        <td style="padding: 10px 0; border-bottom: 1px solid #efeaf5; text-align: right; font-size: 13px; white-space: nowrap; vertical-align: top;">${due}</td>
      </tr>`;
  }).join('');

  return `
    <div style="margin-bottom: 28px;">
      <div style="font-size: 13px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">
        Your open tasks (${tasks.length})
      </div>
      <table style="width: 100%; border-collapse: collapse;">${rows}</table>
    </div>`;
}

/**
 * Daily digest — 3pm PT on weekdays. Always lists the tasks assigned to you,
 * and adds a nudge on top when you haven't logged any time yet today.
 */
async function sendDailyReminder(user, { tasks = [], loggedToday = false, today } = {}) {
  const firstName = user.name.split(' ')[0];
  const todayStr = today || new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const overdueCount = tasks.filter((t) => t.dueDate && dueDateStr(t.dueDate) < todayStr).length;

  const subject = loggedToday
    ? `📋 Your tasks for today${overdueCount ? ` — ${overdueCount} overdue` : ''}`
    : `⏱ Log your time${overdueCount ? ` · ${overdueCount} task${overdueCount === 1 ? '' : 's'} overdue` : ''}`;

  await getResend().emails.send({
    from: FROM,
    to: user.email,
    subject,
    html: `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #2d2d2d;">
        <div style="font-size: 22px; font-weight: 700; color: #4a5240; margin-bottom: 8px;">NorthStar</div>
        <div style="font-size: 13px; color: #888; margin-bottom: 32px; text-transform: uppercase; letter-spacing: 0.05em;">Civic North Consulting</div>

        <p style="font-size: 16px; margin: 0 0 16px;">Hey ${escapeHtml(firstName)},</p>
        ${loggedToday
          ? `<p style="font-size: 16px; margin: 0 0 24px;">Time's logged for today — here's what's still on your plate.</p>`
          : `<p style="font-size: 16px; margin: 0 0 24px;">You haven't logged any time today. Take a minute to get it in before the day gets away from you.</p>`}

        ${taskSection(tasks, todayStr)}

        <a href="${APP_URL()}/${loggedToday ? 'tasks' : 'time'}"
           style="display: inline-block; background: #4a5240; color: #fff; text-decoration: none;
                  padding: 12px 24px; border-radius: 6px; font-size: 15px; font-weight: 600;">
          ${loggedToday ? 'Open Tasks →' : 'Log Time Now →'}
        </a>

        <p style="font-size: 13px; color: #aaa; margin-top: 40px;">
          You're receiving this because notifications are enabled in your NorthStar settings.<br>
          <a href="${APP_URL()}/settings" style="color: #aaa;">Turn off reminders</a>
        </p>
      </div>
    `,
  });

  console.log(`[reminders] Daily digest sent to ${user.email} (${tasks.length} task${tasks.length === 1 ? '' : 's'})`);
}

/**
 * Friday weekly summary email
 */
async function sendWeeklySummary(user, { hoursLogged, hourTarget, topProjects }) {
  const firstName = user.name.split(' ')[0];
  const pct = Math.round((hoursLogged / hourTarget) * 100);
  const onTrack = hoursLogged >= hourTarget;

  const projectRows = topProjects.map(p =>
    `<tr>
      <td style="padding: 6px 0; font-size: 14px; color: #2d2d2d;">${p.name}</td>
      <td style="padding: 6px 0; font-size: 14px; color: #2d2d2d; text-align: right;">${p.hours.toFixed(1)} hrs</td>
    </tr>`
  ).join('');

  await getResend().emails.send({
    from: FROM,
    to: user.email,
    subject: `📋 Your week in review — ${hoursLogged.toFixed(1)} of ${hourTarget} hrs logged`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #2d2d2d;">
        <div style="font-size: 22px; font-weight: 700; color: #4a5240; margin-bottom: 8px;">NorthStar</div>
        <div style="font-size: 13px; color: #888; margin-bottom: 32px; text-transform: uppercase; letter-spacing: 0.05em;">Weekly Summary</div>

        <p style="font-size: 16px; margin: 0 0 24px;">Hey ${firstName}, here's how your week shaped up:</p>

        <!-- Hours bar -->
        <div style="background: #f4f4f0; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span style="font-size: 14px; color: #666;">Hours logged this week</span>
            <span style="font-size: 14px; font-weight: 700; color: ${onTrack ? '#4a5240' : '#c0392b'};">
              ${hoursLogged.toFixed(1)} / ${hourTarget} hrs
            </span>
          </div>
          <div style="background: #e0e0d8; border-radius: 4px; height: 8px;">
            <div style="background: ${onTrack ? '#4a5240' : '#e07b54'}; border-radius: 4px; height: 8px; width: ${Math.min(pct, 100)}%;"></div>
          </div>
          <div style="font-size: 13px; color: ${onTrack ? '#4a5240' : '#c0392b'}; margin-top: 8px; font-weight: 600;">
            ${onTrack ? `✅ On target! Great work this week.` : `⚠️ ${(hourTarget - hoursLogged).toFixed(1)} hrs short of your ${hourTarget}-hr target.`}
          </div>
        </div>

        <!-- Top projects -->
        ${topProjects.length > 0 ? `
        <div style="margin-bottom: 24px;">
          <div style="font-size: 13px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px;">Time by project</div>
          <table style="width: 100%; border-collapse: collapse;">
            ${projectRows}
          </table>
        </div>` : ''}

        <a href="${process.env.FRONTEND_URL || 'https://northstar-eta-ten.vercel.app'}/time"
           style="display: inline-block; background: #4a5240; color: #fff; text-decoration: none;
                  padding: 12px 24px; border-radius: 6px; font-size: 15px; font-weight: 600;">
          Open NorthStar →
        </a>

        <p style="font-size: 13px; color: #aaa; margin-top: 40px;">
          Weekly summary from NorthStar · Civic North Consulting<br>
          <a href="${process.env.FRONTEND_URL || 'https://northstar-eta-ten.vercel.app'}/settings"
             style="color: #aaa;">Manage notification settings</a>
        </p>
      </div>
    `,
  });

  console.log(`[reminders] Weekly summary sent to ${user.email}`);
}

module.exports = { sendDailyReminder, sendWeeklySummary };
