const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const { sendDailyReminder, sendWeeklySummary } = require('./email');

const prisma = new PrismaClient();

/**
 * Returns the start/end of "today" in Pacific time as UTC Date objects.
 * Handles PST (UTC-8) and PDT (UTC-7) automatically via Intl.
 */
function getPacificDayBounds() {
  const now = new Date();

  // Get today's date string in Pacific time
  const pacificDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now); // e.g. "2026-06-04"

  const startOfDay = new Date(`${pacificDate}T00:00:00-07:00`);
  const endOfDay   = new Date(`${pacificDate}T23:59:59-07:00`);
  return { startOfDay, endOfDay };
}

/**
 * Returns the Monday–Sunday bounds of the current Pacific week.
 */
function getPacificWeekBounds() {
  const now = new Date();
  const pacificDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);

  const today = new Date(`${pacificDate}T12:00:00-07:00`);
  const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon … 6=Sat
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const monday = new Date(today);
  monday.setDate(today.getDate() - daysFromMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { monday, sunday };
}

/**
 * Daily check — runs at 3:00 PM Pacific (23:00 UTC, accounts for PDT).
 * Sends reminder to any user who has notifications on and hasn't logged time today.
 * Cron: "0 23 * * 1-5"  (Mon–Fri, 23:00 UTC = 3pm PDT / 4pm PST — close enough,
 * Railway lets us set TZ=America/Los_Angeles so the cron fires at true 3pm local)
 */
async function runDailyReminders() {
  console.log('[reminders] Running daily check…');
  const { startOfDay, endOfDay } = getPacificDayBounds();

  const users = await prisma.user.findMany({
    where: { notificationsEnabled: true },
  });

  for (const user of users) {
    const count = await prisma.timeEntry.count({
      where: {
        userId: user.id,
        date: { gte: startOfDay, lte: endOfDay },
        status: 'CONFIRMED',
      },
    });

    if (count === 0) {
      try {
        await sendDailyReminder(user);
      } catch (err) {
        console.error(`[reminders] Failed to send daily reminder to ${user.email}:`, err.message);
      }
    } else {
      console.log(`[reminders] ${user.name} already logged ${count} entr${count === 1 ? 'y' : 'ies'} today — skipping`);
    }
  }
}

/**
 * Friday weekly summary — runs at 3:00 PM Pacific on Fridays.
 * Sends a summary of hours logged this week vs. target, broken down by project.
 */
async function runWeeklySummary() {
  console.log('[reminders] Running weekly summary…');
  const { monday, sunday } = getPacificWeekBounds();

  const users = await prisma.user.findMany({
    where: { notificationsEnabled: true },
  });

  for (const user of users) {
    const entries = await prisma.timeEntry.findMany({
      where: {
        userId: user.id,
        date: { gte: monday, lte: sunday },
        status: 'CONFIRMED',
      },
      include: {
        project: { include: { client: { select: { name: true } } } },
      },
    });

    const hoursLogged = entries.reduce((sum, e) => sum + e.hours, 0);

    // Aggregate by project
    const projectMap = {};
    for (const entry of entries) {
      const key = entry.project.id;
      if (!projectMap[key]) {
        projectMap[key] = {
          name: `${entry.project.client.name} — ${entry.project.name}`,
          hours: 0,
        };
      }
      projectMap[key].hours += entry.hours;
    }
    const topProjects = Object.values(projectMap)
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 5);

    try {
      await sendWeeklySummary(user, {
        hoursLogged,
        hourTarget: user.weeklyHourTarget,
        topProjects,
      });
    } catch (err) {
      console.error(`[reminders] Failed to send weekly summary to ${user.email}:`, err.message);
    }
  }
}

/**
 * Register all cron jobs. Call this once from index.js.
 * All times are Pacific via TZ env var set in Railway.
 */
function startReminders() {
  // 3:00 PM Pacific, Mon–Thu → daily reminder
  cron.schedule('0 15 * * 1-4', () => {
    runDailyReminders().catch(err => console.error('[reminders] Daily error:', err));
  }, { timezone: 'America/Los_Angeles' });

  // 3:00 PM Pacific, Friday → daily reminder + weekly summary
  cron.schedule('0 15 * * 5', () => {
    runDailyReminders().catch(err => console.error('[reminders] Friday daily error:', err));
    runWeeklySummary().catch(err => console.error('[reminders] Weekly summary error:', err));
  }, { timezone: 'America/Los_Angeles' });

  console.log('[reminders] Scheduled: daily at 3pm PT (Mon–Fri), weekly summary at 3pm PT (Fri)');
}

module.exports = { startReminders, runDailyReminders, runWeeklySummary };
