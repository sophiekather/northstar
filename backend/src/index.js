require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const { startReminders, runDailyReminders, runWeeklySummary } = require('./services/reminders');
const { requireAuth } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const clientRoutes = require('./routes/clients');
const projectRoutes = require('./routes/projects');
const taskTypeRoutes = require('./routes/taskTypes');
const timeEntryRoutes = require('./routes/timeEntries');
const expenseRoutes = require('./routes/expenses');
const mileageRoutes = require('./routes/mileage');
const settingsRoutes = require('./routes/settings');
const reportsRoutes = require('./routes/reports');
const taskRoutes = require('./routes/tasks');
const userRoutes = require('./routes/users');
const mcpRoutes = require('./routes/mcp');

const app = express();

app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'http://localhost:5173',
    'https://northstar-eta-ten.vercel.app',
  ],
  credentials: true,
}));
// Ahead of express.json() and the route-level auth: the MCP endpoint carries its
// own MCP_TOKEN check, and it parses its own body so a malformed payload comes
// back as a JSON-RPC parse error instead of the default HTML 400.
app.use('/api/mcp', mcpRoutes);

app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/task-types', taskTypeRoutes);
app.use('/api/time-entries', timeEntryRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/mileage', mileageRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/users', userRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Test endpoints — fire reminders on demand (auth required)
app.post('/api/admin/test-daily-reminder', requireAuth, async (req, res) => {
  try {
    await runDailyReminders();
    res.json({ ok: true, message: 'Daily reminder check complete — check your inbox!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/test-weekly-summary', requireAuth, async (req, res) => {
  try {
    await runWeeklySummary();
    res.json({ ok: true, message: 'Weekly summary sent — check your inbox!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A failed DB call in an async route must never take down the whole process
// (in modern Node an unhandled rejection is fatal by default).
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`NorthStar backend running on port ${PORT}`);
  startReminders();
});
