// src/pages/StudentShell.jsx
export default function StudentShell({ children, title }) {
  return (
    <div className="page student-page">
      <div className="student-container">
        {title && <h1 className="page-title">{title}</h1>}
        <div className="student-card student-text">
          {children}
        </div>
      </div>
    </div>
  );
}
