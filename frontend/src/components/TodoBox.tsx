import classNames from 'classnames';

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority?: 'high' | 'medium' | 'low';
}

interface TodoBoxProps {
  items: TodoItem[];
}

function StatusIcon({ status }: { status: TodoItem['status'] }) {
  if (status === 'completed') {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="var(--status-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3 8 4 4 6-8" />
      </svg>
    );
  }
  if (status === 'in_progress') {
    return <span className="dot" style={{ width: 8, height: 8 }} />;
  }
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="var(--fg-dim)" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6" />
    </svg>
  );
}

export function TodoBox({ items }: TodoBoxProps) {
  if (items.length === 0) return null;

  const done = items.filter((i) => i.status === 'completed').length;

  return (
    <div className="todo-box">
      <div className="todo-head">
        <span className="todo-title">Tasks</span>
        <span className="todo-count">{done}/{items.length}</span>
      </div>
      <ul className="todo-list">
        {items.map((item, i) => (
          <li
            key={i}
            className={classNames('todo-item', {
              done: item.status === 'completed',
              active: item.status === 'in_progress',
            })}
          >
            <StatusIcon status={item.status} />
            <span className="todo-text">{item.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
