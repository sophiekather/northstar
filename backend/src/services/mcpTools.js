const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Tool catalogue for the MCP connector (see routes/mcp.js for the transport).
//
// These handlers talk to Prisma directly rather than looping back over HTTP to
// our own /api routes. Two reasons: the route handlers are welded to Express
// (they read req.userId and write to res, so there is nothing to import), and
// the bearer-key path in middleware/auth.js sets req.userId = null, which makes
// POST /api/time-entries fail on a non-nullable FK. Going direct lets a tool
// name the acting user explicitly, and keeps one credential in play instead of
// two inside the same process.

const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE'];
const TASK_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'];
const PROJECT_TYPES = ['FIXED_FEE', 'TIME_MATERIALS', 'NON_BILLABLE'];
const PROJECT_STATUSES = ['OPEN', 'CLOSED', 'IN_PROGRESS', 'SUBMITTED', 'PENDING_AWARD', 'BID_AWARDED', 'BID_NOT_AWARDED'];

/**
 * Thrown by handlers for anything the caller can fix by retrying with different
 * arguments. routes/mcp.js turns these into isError results rather than
 * JSON-RPC errors, so Claude reads the message and adapts.
 */
class ToolError extends Error {}

function required(args, key) {
  const value = args[key];
  if (value === undefined || value === null || value === '') {
    throw new ToolError(`${key} is required`);
  }
  return value;
}

function oneOf(value, allowed, key) {
  if (value === undefined) return undefined;
  if (!allowed.includes(value)) {
    throw new ToolError(`${key} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

function num(value, key) {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (Number.isNaN(n)) throw new ToolError(`${key} must be a number`);
  return n;
}

// Task due dates are stored at UTC midnight and compared as calendar dates by
// services/reminders.js, so they parse the same way routes/tasks.js parses them.
function parseDueDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ToolError(`Could not read "${value}" as a date`);
  return d;
}

// Time entry dates anchor to noon UTC instead — same as routes/timeEntries.js,
// so a YYYY-MM-DD never slips a day when rendered in Pacific time.
function parseEntryDate(value) {
  if (!value) return null;
  const d = value.includes('T') ? new Date(value) : new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new ToolError(`Could not read "${value}" as a date`);
  return d;
}

function day(date) {
  return date ? date.toISOString().slice(0, 10) : null;
}

// ---------- response shaping ----------
// MCP results travel as JSON inside a text block, so these return the fields a
// caller actually reasons about rather than the full UI payloads. Relations are
// flattened to names so Claude does not have to join two calls to read a row.

function shapeClient(c) {
  return {
    id: c.id,
    name: c.name,
    emails: c.emails,
    keywords: c.keywords,
    notes: c.notes,
    isActive: c.isActive,
    isInternal: c.isInternal,
  };
}

function shapeProject(p, loggedHours) {
  return {
    id: p.id,
    name: p.name,
    clientId: p.clientId,
    clientName: p.client?.name ?? null,
    type: p.type,
    status: p.status,
    budgetHours: p.budgetHours,
    budgetDollars: p.budgetDollars,
    startDate: day(p.startDate),
    endDate: day(p.endDate),
    isActive: p.isActive,
    isRetainer: !!p.retainerConfig,
    monthlyRetainerHours: p.retainerConfig?.monthlyHours ?? null,
    notes: p.notes,
    ...(loggedHours === undefined ? {} : { loggedHours }),
  };
}

function shapeTask(t, loggedHours) {
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    status: t.status,
    priority: t.priority,
    dueDate: day(t.dueDate),
    projectId: t.projectId,
    projectName: t.project?.name ?? null,
    clientName: t.project?.client?.name ?? null,
    assigneeUserId: t.assigneeUserId,
    assigneeName: t.assigneeUser?.name ?? t.assigneeName ?? null,
    isSubcontractor: t.isSubcontractor,
    subHours: t.subHours,
    subExpenseAmount: t.subExpenseAmount,
    deliverableId: t.deliverableId,
    deliverableName: t.deliverable?.taskType?.name ?? null,
    ...(loggedHours === undefined ? {} : { loggedHours }),
  };
}

function shapeTimeEntry(e) {
  return {
    id: e.id,
    date: day(e.date),
    hours: e.hours,
    hourlyRate: e.hourlyRate,
    isBillable: e.isBillable,
    note: e.note,
    status: e.status,
    userId: e.userId,
    userName: e.user?.name ?? null,
    projectId: e.projectId,
    projectName: e.project?.name ?? null,
    clientName: e.project?.client?.name ?? null,
    taskTypeId: e.taskTypeId,
    taskTypeName: e.taskType?.name ?? null,
    taskId: e.taskId,
    taskTitle: e.task?.title ?? null,
  };
}

const TASK_INCLUDE = {
  project: { select: { id: true, name: true, client: { select: { id: true, name: true } } } },
  assigneeUser: { select: { id: true, name: true } },
  deliverable: { include: { taskType: { select: { id: true, name: true } } } },
};

const TIME_ENTRY_INCLUDE = {
  user: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, client: { select: { id: true, name: true } } } },
  taskType: { select: { id: true, name: true } },
  task: { select: { id: true, title: true } },
};

/** Confirmed hours logged against each task, in one grouped query. */
async function loggedHoursByTask(taskIds) {
  if (taskIds.length === 0) return {};
  const totals = await prisma.timeEntry.groupBy({
    by: ['taskId'],
    where: { taskId: { in: taskIds }, status: 'CONFIRMED' },
    _sum: { hours: true },
  });
  return Object.fromEntries(totals.map((t) => [t.taskId, t._sum.hours || 0]));
}

/** Confirmed hours per project, plus the manual sub hours carried on tasks. */
async function loggedHoursByProject(projectIds) {
  if (projectIds.length === 0) return {};
  const [entries, subs] = await Promise.all([
    prisma.timeEntry.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds }, status: 'CONFIRMED' },
      _sum: { hours: true },
    }),
    prisma.task.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds }, isSubcontractor: true },
      _sum: { subHours: true },
    }),
  ]);
  const totals = {};
  for (const id of projectIds) totals[id] = 0;
  for (const e of entries) totals[e.projectId] += e._sum.hours || 0;
  for (const s of subs) totals[s.projectId] += s._sum.subHours || 0;
  for (const id of projectIds) totals[id] = Math.round(totals[id] * 10) / 10;
  return totals;
}

/** Resolves the acting user for a write, by id or by email. */
async function resolveUserId({ userId, userEmail }) {
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new ToolError(`No user with id ${userId} — call list_users to see the team`);
    return user.id;
  }
  if (userEmail) {
    const user = await prisma.user.findUnique({
      where: { email: userEmail.toLowerCase().trim() },
      select: { id: true },
    });
    if (!user) throw new ToolError(`No user with email ${userEmail} — call list_users to see the team`);
    return user.id;
  }
  throw new ToolError('userId or userEmail is required — there is no session to infer the user from');
}

// ---------- tools ----------

const tools = [
  {
    name: 'list_clients',
    title: 'List clients',
    description:
      'List Civic North clients. Active clients only unless includeArchived is true. ' +
      'Internal (non-billable) clients are flagged with isInternal.',
    inputSchema: {
      type: 'object',
      properties: {
        includeArchived: { type: 'boolean', description: 'Include archived clients. Default false.' },
      },
      additionalProperties: false,
    },
    async handler(args) {
      const clients = await prisma.client.findMany({
        where: args.includeArchived === true ? {} : { isActive: true },
        orderBy: [{ isInternal: 'asc' }, { name: 'asc' }],
      });
      return clients.map(shapeClient);
    },
  },

  {
    name: 'list_projects',
    title: 'List projects',
    description:
      'List projects with their budget and hours logged to date. Filter by client or status. ' +
      'Active projects only unless includeArchived is true.',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string', description: 'Only projects for this client id.' },
        status: { type: 'string', enum: PROJECT_STATUSES, description: 'Only projects in this status.' },
        includeArchived: { type: 'boolean', description: 'Include archived projects. Default false.' },
      },
      additionalProperties: false,
    },
    async handler(args) {
      const where = {};
      if (args.clientId) where.clientId = args.clientId;
      if (args.status) where.status = oneOf(args.status, PROJECT_STATUSES, 'status');
      if (args.includeArchived !== true) where.isActive = true;

      const projects = await prisma.project.findMany({
        where,
        include: { client: { select: { id: true, name: true } }, retainerConfig: true },
        orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }],
      });
      const hours = await loggedHoursByProject(projects.map((p) => p.id));
      return projects.map((p) => shapeProject(p, hours[p.id] ?? 0));
    },
  },

  {
    name: 'list_tasks',
    title: 'List tasks',
    description:
      'List tasks from the task board, with hours logged against each. ' +
      'Defaults to open tasks (everything not DONE); pass status "all" for the full history.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Only tasks on this project.' },
        clientId: { type: 'string', description: 'Only tasks on this client\'s projects. Ignored if projectId is set.' },
        status: {
          type: 'string',
          enum: [...TASK_STATUSES, 'all'],
          description: 'Filter by status, or "all" for every task. Default: open tasks only.',
        },
        assignee: {
          type: 'string',
          description:
            'Assignee filter: "user:<userId>" for a team member, "sub:<name>" for one subcontractor, ' +
            'or "subs" for all subcontractor tasks.',
        },
      },
      additionalProperties: false,
    },
    async handler(args) {
      const where = {};
      if (args.projectId) where.projectId = args.projectId;
      else if (args.clientId) where.project = { clientId: args.clientId };

      if (args.status === 'all') {
        // no status filter
      } else if (args.status) {
        where.status = oneOf(args.status, TASK_STATUSES, 'status');
      } else {
        where.status = { not: 'DONE' };
      }

      if (args.assignee) {
        if (args.assignee === 'subs') where.isSubcontractor = true;
        else if (args.assignee.startsWith('user:')) where.assigneeUserId = args.assignee.slice(5);
        else if (args.assignee.startsWith('sub:')) where.assigneeName = args.assignee.slice(4);
        else throw new ToolError('assignee must look like "user:<userId>", "sub:<name>" or "subs"');
      }

      const tasks = await prisma.task.findMany({
        where,
        include: TASK_INCLUDE,
        orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
      });
      const hours = await loggedHoursByTask(tasks.map((t) => t.id));
      return tasks.map((t) => shapeTask(t, hours[t.id] || 0));
    },
  },

  {
    name: 'list_time_entries',
    title: 'List time entries',
    description:
      'List confirmed time entries, newest first. Unlike the web app this returns the whole ' +
      'team by default — pass userId to narrow it to one person.',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Earliest date, inclusive (YYYY-MM-DD).' },
        endDate: { type: 'string', description: 'Latest date, inclusive (YYYY-MM-DD).' },
        userId: { type: 'string', description: 'Only entries logged by this user.' },
        projectId: { type: 'string', description: 'Only entries on this project.' },
        clientId: { type: 'string', description: 'Only entries on this client\'s projects.' },
        limit: { type: 'integer', description: 'Maximum rows to return. Default 200, max 1000.' },
      },
      additionalProperties: false,
    },
    async handler(args) {
      const where = { status: 'CONFIRMED' };
      if (args.userId) where.userId = args.userId;
      if (args.projectId) where.projectId = args.projectId;
      else if (args.clientId) where.project = { clientId: args.clientId };

      if (args.startDate) where.date = { ...where.date, gte: parseEntryDate(args.startDate) };
      if (args.endDate) where.date = { ...where.date, lte: parseEntryDate(args.endDate) };

      const limit = Math.min(Math.max(num(args.limit, 'limit') ?? 200, 1), 1000);
      const entries = await prisma.timeEntry.findMany({
        where,
        include: TIME_ENTRY_INCLUDE,
        orderBy: { date: 'desc' },
        take: limit,
      });
      return entries.map(shapeTimeEntry);
    },
  },

  {
    name: 'list_users',
    title: 'List team members',
    description:
      'List the Civic North team with their ids and emails. Use this to resolve the user ' +
      'a time entry or task assignment belongs to.',
    inputSchema: {
      type: 'object',
      properties: {
        includeInactive: { type: 'boolean', description: 'Include deactivated users. Default false.' },
      },
      additionalProperties: false,
    },
    async handler(args) {
      const users = await prisma.user.findMany({
        where: args.includeInactive === true ? {} : { isActive: true },
        select: { id: true, name: true, email: true, role: true, isActive: true, weeklyHourTarget: true },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      });
      return users;
    },
  },

  {
    name: 'list_task_types',
    title: 'List task types',
    description:
      'List task types (the work categories time is logged against). ' +
      'A time entry needs one of these ids.',
    inputSchema: {
      type: 'object',
      properties: {
        includeArchived: { type: 'boolean', description: 'Include archived task types. Default false.' },
      },
      additionalProperties: false,
    },
    async handler(args) {
      return prisma.taskType.findMany({
        where: args.includeArchived === true ? {} : { isArchived: false },
        select: { id: true, name: true, defaultHourlyRate: true, isBillableDefault: true, isArchived: true },
        orderBy: { name: 'asc' },
      });
    },
  },

  {
    name: 'create_task',
    title: 'Create a task',
    description: 'Add a task to a project\'s board. Returns the created task.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project the task belongs to.' },
        title: { type: 'string', description: 'Short task title.' },
        notes: { type: 'string', description: 'Longer description or context.' },
        status: { type: 'string', enum: TASK_STATUSES, description: 'Default TODO.' },
        priority: { type: 'string', enum: TASK_PRIORITIES, description: 'Default MEDIUM.' },
        dueDate: { type: 'string', description: 'Due date (YYYY-MM-DD).' },
        assigneeUserId: { type: 'string', description: 'Team member id — see list_users.' },
        assigneeName: { type: 'string', description: 'Free-text name, for a subcontractor with no login.' },
        isSubcontractor: { type: 'boolean', description: 'True when the work is done by a subcontractor.' },
        subHours: { type: 'number', description: 'Hours billed by the subcontractor (they cannot log time themselves).' },
        subExpenseAmount: { type: 'number', description: 'Flat amount billed by the subcontractor.' },
        deliverableId: { type: 'string', description: 'ProjectTask id this task rolls up to.' },
      },
      required: ['projectId', 'title'],
      additionalProperties: false,
    },
    async handler(args) {
      const projectId = required(args, 'projectId');
      const title = required(args, 'title');

      const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
      if (!project) throw new ToolError(`No project with id ${projectId} — call list_projects first`);

      // Rank is board-wide, matching routes/tasks.js — new tasks land at the bottom.
      const max = await prisma.task.aggregate({ _max: { rank: true } });
      const task = await prisma.task.create({
        data: {
          projectId,
          title,
          notes: args.notes || null,
          assigneeUserId: args.assigneeUserId || null,
          assigneeName: args.assigneeName || null,
          isSubcontractor: !!args.isSubcontractor,
          subHours: num(args.subHours, 'subHours'),
          subExpenseAmount: num(args.subExpenseAmount, 'subExpenseAmount'),
          priority: oneOf(args.priority, TASK_PRIORITIES, 'priority') || 'MEDIUM',
          status: oneOf(args.status, TASK_STATUSES, 'status') || 'TODO',
          dueDate: parseDueDate(args.dueDate),
          deliverableId: args.deliverableId || null,
          rank: (max._max.rank ?? 0) + 1,
        },
        include: TASK_INCLUDE,
      });
      return shapeTask(task, 0);
    },
  },

  {
    name: 'update_task',
    title: 'Update a task',
    description:
      'Change fields on an existing task — omitted fields are left alone. ' +
      'Set status to DONE to close it out.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task id.' },
        title: { type: 'string' },
        notes: { type: 'string', description: 'Pass an empty string to clear.' },
        status: { type: 'string', enum: TASK_STATUSES },
        priority: { type: 'string', enum: TASK_PRIORITIES },
        dueDate: { type: 'string', description: 'YYYY-MM-DD, or an empty string to clear.' },
        projectId: { type: 'string', description: 'Move the task to another project.' },
        assigneeUserId: { type: 'string', description: 'Empty string to unassign.' },
        assigneeName: { type: 'string', description: 'Empty string to clear.' },
        isSubcontractor: { type: 'boolean' },
        subHours: { type: 'number' },
        subExpenseAmount: { type: 'number' },
        deliverableId: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    async handler(args) {
      const id = required(args, 'id');
      const existing = await prisma.task.findUnique({ where: { id }, select: { id: true } });
      if (!existing) throw new ToolError(`No task with id ${id} — call list_tasks first`);

      const data = {};
      if (args.projectId !== undefined) data.projectId = args.projectId;
      if (args.title !== undefined) data.title = args.title;
      if (args.notes !== undefined) data.notes = args.notes || null;
      if (args.assigneeUserId !== undefined) data.assigneeUserId = args.assigneeUserId || null;
      if (args.assigneeName !== undefined) data.assigneeName = args.assigneeName || null;
      if (args.isSubcontractor !== undefined) data.isSubcontractor = !!args.isSubcontractor;
      if (args.subHours !== undefined) data.subHours = num(args.subHours, 'subHours');
      if (args.subExpenseAmount !== undefined) data.subExpenseAmount = num(args.subExpenseAmount, 'subExpenseAmount');
      if (args.priority !== undefined) data.priority = oneOf(args.priority, TASK_PRIORITIES, 'priority');
      if (args.status !== undefined) data.status = oneOf(args.status, TASK_STATUSES, 'status');
      if (args.dueDate !== undefined) data.dueDate = parseDueDate(args.dueDate);
      if (args.deliverableId !== undefined) data.deliverableId = args.deliverableId || null;

      if (Object.keys(data).length === 0) throw new ToolError('Nothing to update — pass at least one field besides id');

      const task = await prisma.task.update({ where: { id }, data, include: TASK_INCLUDE });
      const hours = await loggedHoursByTask([task.id]);
      return shapeTask(task, hours[task.id] || 0);
    },
  },

  {
    name: 'create_time_entry',
    title: 'Log time',
    description:
      'Log hours against a project. Requires the acting user (userId or userEmail) because ' +
      'there is no browser session to infer it from. Entries are created CONFIRMED.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'Who the time belongs to — see list_users.' },
        userEmail: { type: 'string', description: 'Alternative to userId.' },
        projectId: { type: 'string', description: 'Project the time is logged against.' },
        taskTypeId: { type: 'string', description: 'Work category — see list_task_types.' },
        date: { type: 'string', description: 'Date worked (YYYY-MM-DD).' },
        hours: { type: 'number', description: 'Hours worked. Must be greater than 0.' },
        taskId: { type: 'string', description: 'Optional task on the board this time rolls up to.' },
        hourlyRate: { type: 'number', description: 'Rate for this entry. Defaults to 0, as the web app does.' },
        isBillable: { type: 'boolean', description: 'Defaults to the user\'s preset for the project, then true.' },
        note: { type: 'string', description: 'What was worked on.' },
        noteClientVisible: { type: 'boolean', description: 'Show the note on client reports. Default false.' },
      },
      required: ['projectId', 'taskTypeId', 'date', 'hours'],
      additionalProperties: false,
    },
    async handler(args) {
      const userId = await resolveUserId(args);
      const projectId = required(args, 'projectId');
      const taskTypeId = required(args, 'taskTypeId');
      required(args, 'date');
      const hours = num(required(args, 'hours'), 'hours');
      if (hours <= 0) throw new ToolError('hours must be greater than 0');

      const [project, taskType] = await Promise.all([
        prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }),
        prisma.taskType.findUnique({ where: { id: taskTypeId }, select: { id: true } }),
      ]);
      if (!project) throw new ToolError(`No project with id ${projectId} — call list_projects first`);
      if (!taskType) throw new ToolError(`No task type with id ${taskTypeId} — call list_task_types first`);

      // No explicit flag → the user's admin-configured preset for this project, then billable.
      let billable = args.isBillable;
      if (billable === undefined) {
        const rule = await prisma.userProjectBillableDefault.findUnique({
          where: { userId_projectId: { userId, projectId } },
        });
        billable = rule?.isBillable;
      }

      const entry = await prisma.timeEntry.create({
        data: {
          userId,
          projectId,
          taskTypeId,
          taskId: args.taskId || null,
          date: parseEntryDate(args.date),
          hours,
          hourlyRate: num(args.hourlyRate, 'hourlyRate') ?? 0,
          isBillable: billable ?? true,
          note: args.note || null,
          noteClientVisible: args.noteClientVisible ?? false,
        },
        include: TIME_ENTRY_INCLUDE,
      });
      return shapeTimeEntry(entry);
    },
  },

  {
    name: 'create_project',
    title: 'Create a project',
    description: 'Open a new project under a client.',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string', description: 'Client the project belongs to — see list_clients.' },
        name: { type: 'string', description: 'Project name.' },
        type: { type: 'string', enum: PROJECT_TYPES, description: 'Billing model.' },
        status: { type: 'string', enum: PROJECT_STATUSES, description: 'Default OPEN.' },
        budgetHours: { type: 'number', description: 'Forecast hours, used for the burn gauge.' },
        budgetDollars: { type: 'number', description: 'Budget in dollars.' },
        startDate: { type: 'string', description: 'YYYY-MM-DD.' },
        endDate: { type: 'string', description: 'YYYY-MM-DD.' },
        notes: { type: 'string' },
        taskTypeIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task types to enable as deliverables on this project.',
        },
      },
      required: ['clientId', 'name', 'type'],
      additionalProperties: false,
    },
    async handler(args) {
      const clientId = required(args, 'clientId');
      const name = required(args, 'name');
      const type = oneOf(required(args, 'type'), PROJECT_TYPES, 'type');

      const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
      if (!client) throw new ToolError(`No client with id ${clientId} — call list_clients first`);

      const project = await prisma.project.create({
        data: {
          clientId,
          name,
          type,
          status: oneOf(args.status, PROJECT_STATUSES, 'status') || undefined,
          budgetHours: num(args.budgetHours, 'budgetHours'),
          budgetDollars: num(args.budgetDollars, 'budgetDollars'),
          startDate: parseDueDate(args.startDate),
          endDate: parseDueDate(args.endDate),
          notes: args.notes || null,
          projectTasks: args.taskTypeIds?.length
            ? { create: args.taskTypeIds.map((id) => ({ taskTypeId: id })) }
            : undefined,
        },
        include: { client: { select: { id: true, name: true } }, retainerConfig: true },
      });
      return shapeProject(project, 0);
    },
  },

  {
    name: 'create_client',
    title: 'Create a client',
    description: 'Add a client. Keywords and emails feed the calendar/email matching rules.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Client name.' },
        emails: { type: 'array', items: { type: 'string' }, description: 'Contact email addresses.' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'Terms that identify this client.' },
        notes: { type: 'string' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    async handler(args) {
      const name = required(args, 'name');
      const client = await prisma.client.create({
        data: {
          name,
          emails: args.emails || [],
          keywords: args.keywords || [],
          notes: args.notes || null,
        },
      });
      return shapeClient(client);
    },
  },
];

const byName = new Map(tools.map((t) => [t.name, t]));

/** The catalogue as MCP sends it — same list, minus the handlers. */
function listTools() {
  return tools.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema }));
}

/**
 * Runs a tool by name. Throws ToolError for anything the caller can fix;
 * anything else is a genuine server fault and propagates.
 */
async function callTool(name, args = {}) {
  const tool = byName.get(name);
  if (!tool) throw new ToolError(`Unknown tool "${name}" — call tools/list to see what is available`);
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new ToolError('arguments must be an object');
  }
  return tool.handler(args);
}

module.exports = { listTools, callTool, toolNames: tools.map((t) => t.name), ToolError, prisma };
