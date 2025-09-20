// src/pages/StudentShell.jsx
export default function StudentShell({ children }) {
  return (
    <div className="page student-page">
      <div className="student-container">
        {children}
      </div>
    </div>
  );
}
