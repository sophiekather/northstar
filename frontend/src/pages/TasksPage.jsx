import TaskBoard from '../components/TaskBoard';

// One ranked list; assignee lives on each card and you filter down (wireframe 2b)
export default function TasksPage() {
  return (
    <div>
      <h1 className="page-title mb-6">Tasks</h1>
      <div className="max-w-3xl">
        <TaskBoard />
      </div>
    </div>
  );
}
