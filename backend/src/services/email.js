const { Resend } = require('resend');

const FROM = 'reminders@civicnorthconsulting.com';

function getResend() {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
  return new Resend(process.env.RESEND_API_KEY);
}

/**
 * Daily reminder — sent at 3pm PT on weekdays if no time logged today
 */
async function sendDailyReminder(user) {
  const firstName = user.name.split(' ')[0];

  await getResend().emails.send({
    from: FROM,
    to: user.email,
    subject: `⏱ Don't forget to log your time today`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #2d2d2d;">
        <div style="font-size: 22px; font-weight: 700; color: #4a5240; margin-bottom: 8px;">NorthStar</div>
        <div style="font-size: 13px; color: #888; margin-bottom: 32px; text-transform: uppercase; letter-spacing: 0.05em;">Civic North Consulting</div>

        <p style="font-size: 16px; margin: 0 0 16px;">Hey ${firstName},</p>
        <p style="font-size: 16px; margin: 0 0 24px;">It looks like you haven't logged any time today. Take a minute to get it in before the day gets away from you!</p>

        <a href="${process.env.FRONTEND_URL || 'https://northstar-eta-ten.vercel.app'}/time"
           style="display: inline-block; background: #4a5240; color: #fff; text-decoration: none;
                  padding: 12px 24px; border-radius: 6px; font-size: 15px; font-weight: 600;">
          Log Time Now →
        </a>

        <p style="font-size: 13px; color: #aaa; margin-top: 40px;">
          You're receiving this because notifications are enabled in your NorthStar settings.<br>
          <a href="${process.env.FRONTEND_URL || 'https://northstar-eta-ten.vercel.app'}/settings"
             style="color: #aaa;">Turn off reminders</a>
        </p>
      </div>
    `,
  });

  console.log(`[reminders] Daily reminder sent to ${user.email}`);
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
