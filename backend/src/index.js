require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const authRoutes = require('./routes/auth');
const clientRoutes = require('./routes/clients');
const projectRoutes = require('./routes/projects');
const taskTypeRoutes = require('./routes/taskTypes');
const timeEntryRoutes = require('./routes/timeEntries');
const expenseRoutes = require('./routes/expenses');
const mileageRoutes = require('./routes/mileage');
const settingsRoutes = require('./routes/settings');

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
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

app.get('/api/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`NorthStar backend running on port ${PORT}`));
